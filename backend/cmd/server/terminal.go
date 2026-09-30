package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

const terminalStreamPath = "/api/terminal/stream"

var terminalUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}

		originURL, err := url.Parse(origin)
		if err == nil && originURL.Host != "" && sameHost(originURL.Host, r.Host) {
			return true
		}

		allowedOrigins := splitAndTrim(os.Getenv("ALLOWED_ORIGINS"))
		for _, allowedOrigin := range allowedOrigins {
			if origin == allowedOrigin {
				return true
			}
		}

		return false
	},
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
	shell         []string
}

type wsWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (w *wsWriter) Write(p []byte) (int, error) {
	message := terminalMessage{Type: "output", Data: string(p)}

	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.conn.WriteJSON(message); err != nil {
		return 0, err
	}

	return len(p), nil
}

type wsInputBuffer struct {
	mu      sync.Mutex
	cond    *sync.Cond
	buffer  []byte
	closed  bool
	readErr error
}

func newWSInputBuffer() *wsInputBuffer {
	reader := &wsInputBuffer{}
	reader.cond = sync.NewCond(&reader.mu)
	return reader
}

func (r *wsInputBuffer) push(data string) {
	r.mu.Lock()
	r.buffer = append(r.buffer, []byte(data)...)
	r.cond.Signal()
	r.mu.Unlock()
}

func (r *wsInputBuffer) close(err error) {
	r.mu.Lock()
	r.closed = true
	r.readErr = err
	r.cond.Broadcast()
	r.mu.Unlock()
}

func (r *wsInputBuffer) Read(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

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

type wsResizeQueue struct {
	mu      sync.Mutex
	cond    *sync.Cond
	queue   []remotecommand.TerminalSize
	closed  bool
	context context.Context
}

func newWSResizeQueue(ctx context.Context) *wsResizeQueue {
	queue := &wsResizeQueue{context: ctx}
	queue.cond = sync.NewCond(&queue.mu)
	return queue
}

func (q *wsResizeQueue) push(size remotecommand.TerminalSize) {
	q.mu.Lock()
	q.queue = append(q.queue, size)
	q.cond.Signal()
	q.mu.Unlock()
}

func (q *wsResizeQueue) close() {
	q.mu.Lock()
	q.closed = true
	q.cond.Broadcast()
	q.mu.Unlock()
}

func (q *wsResizeQueue) Next() *remotecommand.TerminalSize {
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
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	clientConfig, err := loadKubernetesConfig()
	if err != nil {
		writeTerminalError(conn, fmt.Sprintf("failed to load kubernetes config: %v", err))
		return
	}

	config, err := loadTerminalConfig()
	if err != nil {
		writeTerminalError(conn, err.Error())
		return
	}

	clientset, err := kubernetes.NewForConfig(clientConfig)
	if err != nil {
		writeTerminalError(conn, fmt.Sprintf("failed to create kubernetes client: %v", err))
		return
	}

	podName, err := resolveRunningPod(ctx, clientset, config.namespace, config.labelSelector)
	if err != nil {
		writeTerminalError(conn, err.Error())
		return
	}

	input := newWSInputBuffer()
	resizes := newWSResizeQueue(ctx)
	output := &wsWriter{conn: conn}

	go func() {
		defer cancel()
		defer input.close(nil)
		defer resizes.close()

		for {
			var message terminalMessage
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
	}()

	execRequest := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(config.namespace).
		SubResource("exec").
		VersionedParams(&v1.PodExecOptions{
			Container: config.containerName,
			Command:   config.shell,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(clientConfig, http.MethodPost, execRequest.URL())
	if err != nil {
		writeTerminalError(conn, fmt.Sprintf("failed to create exec session: %v", err))
		return
	}

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

func loadTerminalConfig() (terminalConfig, error) {
	namespace := strings.TrimSpace(os.Getenv("TERMINAL_NAMESPACE"))
	if namespace == "" {
		namespace = readNamespaceFromServiceAccount()
	}
	if namespace == "" {
		namespace = "labs"
	}
	if namespace == "" {
		return terminalConfig{}, errors.New("terminal namespace is not configured")
	}

	selector := strings.TrimSpace(os.Getenv("TERMINAL_POD_LABEL_SELECTOR"))
	if selector == "" {
		selector = "app=lab-shell"
	}

	containerName := strings.TrimSpace(os.Getenv("TERMINAL_CONTAINER"))
	if containerName == "" {
		containerName = "shell"
	}

	shellCommand := splitAndTrim(os.Getenv("TERMINAL_SHELL"))
	if len(shellCommand) == 0 {
		shellCommand = []string{"/bin/sh"}
	}

	return terminalConfig{
		namespace:     namespace,
		labelSelector: selector,
		containerName: containerName,
		shell:         shellCommand,
	}, nil
}

func loadKubernetesConfig() (*rest.Config, error) {
	if clientConfig, err := rest.InClusterConfig(); err == nil {
		return clientConfig, nil
	}

	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, &clientcmd.ConfigOverrides{})

	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, err
	}

	return restConfig, nil
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

func sameHost(left, right string) bool {
	leftParts := strings.Split(left, ":")
	rightParts := strings.Split(right, ":")
	if len(leftParts) == 0 || len(rightParts) == 0 {
		return false
	}
	return strings.EqualFold(leftParts[0], rightParts[0])
}