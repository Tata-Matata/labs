package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"
)

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// against cross site web socket hijacking
	CheckOrigin: checkOrigin,
}

type terminalMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

type terminalConfig struct {
	namespace     string
	labelSelector string
	containerName string
	shells        []string
}

type websocketWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

// implements interface io.Writer so that websocketWriter implicitly implements io.Writer
func (w *websocketWriter) Write(p []byte) (int, error) {
	message := terminalMessage{Type: "output", Data: string(p)}

	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.conn.WriteJSON(message); err != nil {
		return 0, err
	}

	return len(p), nil
}

type websocketInputBuffer struct {
	mu      sync.Mutex
	cond    *sync.Cond
	buffer  []byte
	closed  bool
	readErr error
}

func newWebsocketInputBuffer() *websocketInputBuffer {
	reader := &websocketInputBuffer{}
	reader.cond = sync.NewCond(&reader.mu)
	return reader
}

func (r *websocketInputBuffer) push(data string) {
	r.mu.Lock()
	r.buffer = append(r.buffer, []byte(data)...)
	r.cond.Signal()
	r.mu.Unlock()
}

func (r *websocketInputBuffer) close(err error) {
	r.mu.Lock()
	r.closed = true
	r.readErr = err
	r.cond.Broadcast()
	r.mu.Unlock()
}

// makes websocketInputBuffer an io.Reader to be used by K8s remotecommand executor
// to read commands from the buffer and send them to the pod container exec session
func (r *websocketInputBuffer) Read(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// wait while empty for signal from push and release mutex
	for len(r.buffer) == 0 && !r.closed {
		r.cond.Wait()
	}

	if len(r.buffer) == 0 && r.closed {
		if r.readErr != nil {
			return 0, r.readErr
		}
		return 0, io.EOF
	}

	n := copy(p, r.buffer)
	r.buffer = r.buffer[n:]
	return n, nil
}

type websocketResizeQueue struct {
	mu      sync.Mutex
	cond    *sync.Cond
	queue   []remotecommand.TerminalSize
	closed  bool
	context context.Context
}

func newWebsocketResizeQueue(ctx context.Context) *websocketResizeQueue {
	queue := &websocketResizeQueue{context: ctx}
	queue.cond = sync.NewCond(&queue.mu)
	return queue
}

func (q *websocketResizeQueue) push(size remotecommand.TerminalSize) {
	q.mu.Lock()
	q.queue = append(q.queue, size)
	q.cond.Signal()
	q.mu.Unlock()
}

func (q *websocketResizeQueue) close() {
	q.mu.Lock()
	q.closed = true
	q.cond.Broadcast()
	q.mu.Unlock()
}

func (q *websocketResizeQueue) Next() *remotecommand.TerminalSize {
	q.mu.Lock()
	defer q.mu.Unlock()

	for len(q.queue) == 0 && !q.closed {
		if err := q.context.Err(); err != nil {
			return nil
		}
		q.cond.Wait()
	}

	if len(q.queue) == 0 {
		return nil
	}

	next := q.queue[0]
	q.queue = q.queue[1:]
	return &next
}

func terminalStreamHandler(w http.ResponseWriter, r *http.Request) {

	// Only HTTP GET
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// child context of request context - for terminal
	// WithCancel returns a derived context that points to the parent context
	// but has a new Done channel.
	// This Done channel is closed when the returned cancel function is called
	// or when the parent context's Done channel is closed,
	// whichever happens first.
	ctx, cancel := context.WithCancel(r.Context())
	//important for long-lived terminal operations -
	// canceling this context releases resources associated with it,
	// so code should call cancel as soon as the operations
	// running in this Context complete.
	defer cancel()

	// upgrade from HTTP to WebSocket
	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// Browser input stream --> InputBuffer for K8s

	input := newWebsocketInputBuffer()
	resizes := newWebsocketResizeQueue(ctx)

	// run in separate go routine to fill input buffer while
	// the subsequent code in the handler function simultaneously
	// reads and empties the buffer and sends commands to pod
	go readWebSocket(input, resizes, conn, cancel)

	// InputBuffer --> K8s pod console exec stream --> websocketWriter --> Browser
	execCommandsInPod(input, resizes, ctx, conn)

}

func prepareK8sClient(conn *websocket.Conn) (*kubernetes.Clientset, *rest.Config, error) {
	// access parameters to connect to K8s cluster
	// either from inside the pod or from local dev env
	k8sClientConfig, err := loadK8sAccessConfig()
	if err != nil {
		writeTerminalError(conn, fmt.Sprintf("failed to load kubernetes config: %v", err))
		return nil, nil, err
	}

	// k8s Client
	k8sClient, err := kubernetes.NewForConfig(k8sClientConfig)
	if err != nil {
		writeTerminalError(conn, fmt.Sprintf("failed to create kubernetes client: %v", err))
		return nil, nil, err
	}

	return k8sClient, k8sClientConfig, nil
}

func execCommandsInPod(input *websocketInputBuffer, resizes *websocketResizeQueue, ctx context.Context, conn *websocket.Conn) {
	k8sClient, k8sClientConfig, err := prepareK8sClient(conn)
	if err != nil {
		return
	}

	// REST request to K8s API to exec into pod
	execRequest, err := prepareExecRequest(k8sClient, ctx, conn)
	if err != nil {
		writeTerminalError(conn, err.Error())
		return
	}

	executor, err := remotecommand.NewSPDYExecutor(k8sClientConfig, http.MethodPost, execRequest.URL())
	if err != nil {
		writeTerminalError(conn, fmt.Sprintf("failed to create exec session: %v", err))
		return
	}

	output := &websocketWriter{conn: conn}

	if err := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             input,
		Stdout:            output,
		Stderr:            output,
		Tty:               true,
		TerminalSizeQueue: resizes,
	}); err != nil && !errors.Is(err, context.Canceled) {
		writeTerminalError(conn, fmt.Sprintf("terminal session ended: %v", err))
	}
}

func prepareExecRequest(k8sClient *kubernetes.Clientset, ctx context.Context, conn *websocket.Conn) (*rest.Request, error) {
	// parameters to find the pod to exec into and provide the lab shell
	config, err := loadTerminalConfig()
	if err != nil {
		writeTerminalError(conn, err.Error())
		return nil, err
	}

	// currently lab pods are deployed in advance, together with the app
	// so we can find an already existing pod in the cluster that will provide the lab
	// TODO: maybe check Readiness state and conceptually rework finding or rolling out pods
	podName, err := resolveRunningPod(ctx, k8sClient, config.namespace, config.labelSelector)
	if err != nil {
		writeTerminalError(conn, err.Error())
		return nil, err
	}

	// REST request to K8s API to exec into pod
	execRequest := k8sClient.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(config.namespace).
		SubResource("exec").
		VersionedParams(&v1.PodExecOptions{
			Container: config.containerName,
			Command:   config.shells,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	return execRequest, nil
}

func readWebSocket(input *websocketInputBuffer, resizes *websocketResizeQueue, conn *websocket.Conn, cancel context.CancelFunc) {
	defer cancel()
	defer input.close(nil)
	defer resizes.close()

	for {
		var message terminalMessage

		// ReadJSON = wait until the next websocket message arrives
		if err := conn.ReadJSON(&message); err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) || errors.Is(err, io.EOF) {
				return
			}
			input.close(err)
			return
		}

		switch message.Type {
		case "input":
			input.push(message.Data)
		case "resize":
			if message.Cols > 0 && message.Rows > 0 {
				resizes.push(remotecommand.TerminalSize{Width: message.Cols, Height: message.Rows})
			}
		}
	}
}

// parameters to find a pod that will provide lab environment
func loadTerminalConfig() (terminalConfig, error) {

	// the namespace where the lab pod will be created
	namespace := loadNamespace()
	if namespace == "" {
		return terminalConfig{}, errors.New("terminal namespace is not configured")
	}

	// the pod label
	podSelector := loadPodLabelSelector()
	if podSelector == "" {
		return terminalConfig{}, errors.New("pod label selector is not configured")
	}

	// the pod container
	containerName := loadPodContainer()
	if containerName == "" {
		return terminalConfig{}, errors.New("container name is not configured")
	}

	// terminal we can use to exec into pod's container
	shells := loadLabShells()
	if len(shells) == 0 {
		return terminalConfig{}, errors.New("No lab shell is configured")
	}

	return terminalConfig{
		namespace:     namespace,
		labelSelector: podSelector,
		containerName: containerName,
		shells:        shells,
	}, nil
}

func loadLabShells() []string {
	return splitAndTrim(os.Getenv("TERMINAL_SHELL"))
}

func loadPodContainer() string {
	return strings.TrimSpace(os.Getenv("TERMINAL_CONTAINER"))
}

func loadPodLabelSelector() string {
	return strings.TrimSpace(os.Getenv("TERMINAL_POD_LABEL_SELECTOR"))
}

func loadNamespace() string {
	namespace := strings.TrimSpace(os.Getenv("TERMINAL_NAMESPACE"))
	if namespace == "" {
		namespace = readNamespaceFromServiceAccount()
	}

	return namespace
}

func loadK8sAccessConfig() (*rest.Config, error) {
	// 2 alternative ways to load kubeconfig, for 2 environments: inside Go pod in the PROD cluster, or local DEV

	// InClusterConfig returns a config object which uses the service account kubernetes gives to pods.
	// It's intended for clients that expect to be running inside a pod running on kubernetes.
	// It will return ErrNotInCluster if called from a process not running in a kubernetes environment.
	// uses KUBERNETES_SERVICE_HOST, KUBERNETES_SERVICE_PORT, service account token, CA certificate etc,
	// so that pod can talk to K8s API
	if clientConfig, err := getK8sClientConfigFromInsideGoPod(); err == nil {
		return clientConfig, nil
	}
	// if InClusterConfig fails, because the app is not running inside pod
	//  - use ~/.kube/config (for ex., local dev)
	restConfig, err := loadK8sConfigFromUserKubeconfigFile()
	if err != nil {
		return nil, err
	}

	return restConfig, nil
}

func loadK8sConfigFromUserKubeconfigFile() (*rest.Config, error) {

	//only instructions for loading the kubeconfig. Not config itself
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()

	//Create a client configuration loader using those rules, without overriding the configuration
	// ConfigOverrides is empty, so not overriding anything
	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, &clientcmd.ConfigOverrides{})

	// actually resolve that configuration into a rest.Config
	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, err
	}

	return restConfig, nil
}

func getK8sClientConfigFromInsideGoPod() (*rest.Config, error) {
	if clientConfig, err := rest.InClusterConfig(); err == nil {
		return clientConfig, nil
	} else {
		return nil, err
	}
}

func resolveRunningPod(ctx context.Context, clientset kubernetes.Interface, namespace, labelSelector string) (string, error) {
	pods, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: labelSelector})
	if err != nil {
		return "", fmt.Errorf("failed to list terminal pods: %w", err)
	}

	for _, pod := range pods.Items {
		if pod.Status.Phase == v1.PodRunning {
			return pod.Name, nil
		}
	}

	return "", fmt.Errorf("no running terminal pod found for selector %q", labelSelector)
}

func writeTerminalError(conn *websocket.Conn, message string) {
	_ = conn.WriteJSON(terminalMessage{Type: "error", Data: message})
	_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, message))
}

func readNamespaceFromServiceAccount() string {
	data, err := os.ReadFile(filepath.Clean("/var/run/secrets/kubernetes.io/serviceaccount/namespace"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func splitAndTrim(value string) []string {
	parts := strings.Split(value, ",")
	trimmed := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			trimmed = append(trimmed, item)
		}
	}
	return trimmed
}
