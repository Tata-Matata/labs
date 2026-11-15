# Traefik configuration

Traefik is installed with the official Helm chart, configured by [traefik-values.yaml](./traefik-values.yaml).

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm upgrade --install traefik traefik/traefik \
  --namespace traefik --create-namespace \
  -f expose/traefik-values.yaml
```

## Values

| Key | Value | Purpose |
|-----|-------|---------|
| `deployment.replicas` | `2` | Run two Traefik pods for availability. |
| `service.enabled` | `true` | Create a Kubernetes Service for Traefik. |
| `service.spec.type` | `NodePort` | Expose the Service on a port of every node |
| `ingressClass.enabled` | `true` | Create an `IngressClass` resource for Traefik. |
| `ingressClass.isDefaultClass` | `false` | Not the cluster default; Ingresses must set `ingressClassName: traefik` explicitly. |
| `ingressClass.name` | `traefik` | Name of the `IngressClass`. |
| `providers.kubernetesIngress.enabled` | `true` | Watch standard `networking.k8s.io/v1` Ingress resources. |

### Ports (entrypoints)

| Entrypoint | Key | Value | Purpose |
|------------|-----|-------|---------|
| `web` (HTTP) | `ports.web.expose.default` | `false` | Port not listed on the Service, so plain HTTP is unreachable from outside (see below). |
| `websecure` (HTTPS) | `ports.websecure.port` | `8443` | Port the Traefik container listens on. |
| | `ports.websecure.exposedPort` | `443` | Port exposed on the Service. |
| | `ports.websecure.nodePort` | `30443` | Fixed port on each node (must be within the NodePort range 30000–32767). |
| | `ports.websecure.expose.default` | `true` | Port listed on the Service, so HTTPS is reachable from outside (see below). |

#### Why `ports.web` is in the file

`web` and `websecure` are not arbitrary names: they are the entrypoints predefined in the Helm chart's default values (`ports.web` on container port 8000 / exposed 80, `ports.websecure` on 8443 / exposed 443; the chart also has internal `traefik` and `metrics` entrypoints). The key under `ports` **is** the entrypoint name, which is why the Ingress annotation can refer to `websecure`.

Values files are merged over the chart defaults, so anything not listed keeps its default. `ports.web` is listed **only to override** a default: without it, the chart would expose HTTP on port 80 of the Service. No Ingress uses `web`, so the entry exists solely to turn it off (`expose.default: false`). Deleting it would open HTTP.

#### What `expose.default` means

In the Traefik Helm chart, each entrypoint under `ports.<name>` has an `expose` map with one flag per Kubernetes Service. `default` refers to the main Traefik Service (the one enabled by `service.enabled`); extra Services, if any are defined, get their own key next to it.

The flag controls only whether the entrypoint's port is **listed on that Service**:

- `ports.websecure.expose.default: true`: the Service gets port `443` (→ container port `8443`, node port `30443`). HTTPS traffic can reach Traefik from outside the cluster.
- `ports.web.expose.default: false`: the Service does **not** get a port for HTTP. Nothing outside the cluster can reach the `web` entrypoint via the Service, so port 80 is effectively closed.

It does **not** remove the entrypoint itself: Traefik still listens on `web` inside the pod, and the entrypoint remains usable in Ingress annotations. It simply has no route in through the Service. The result is HTTPS-only access (there is no HTTP→HTTPS redirect either; HTTP requests simply fail to connect).

To open plain HTTP later, set `ports.web.expose.default: true` (optionally also `exposedPort: 80` and a `nodePort`).

Resulting traffic path: `client :30443 (node) → Service :443 → Traefik pod :8443`.
A load balancer/firewall in front of the nodes is expected to map public `443` to node port `30443`.

## Related manifests (not part of the values file)

- [ingres-traefik.yaml](./ingres-traefik.yaml): Ingress `labs-frontend` in namespace `labs`; uses `ingressClassName: traefik`, annotation `traefik.ingress.kubernetes.io/router.entrypoints: websecure` (explained below), routes host `tata-labs.com` path `/` to Service `labs-frontend:80`, TLS from secret `tata-labs-tls-prod`.

### The `router.entrypoints` annotation

```yaml
annotations:
  traefik.ingress.kubernetes.io/router.entrypoints: websecure
```

An *entrypoint* is a port Traefik listens on. The chart defines `web` (HTTP) and `websecure` (HTTPS), configured under `ports` in the values file. For every Ingress it reads, Traefik creates a *router*. By default, that router is attached to **all** entrypoints.

This annotation restricts the router created from this Ingress to the listed entrypoints (comma-separated for several, e.g. `web,websecure`). Here it pins `labs-frontend` to `websecure`, so the host `tata-labs.com` is served only over HTTPS and is never matched on the `web` entrypoint.

Notes:
- The value must be an entrypoint **name** from the values file (`web`, `websecure`), not a port number.
- It is independent of `ports.*.expose.default`: `expose` decides whether a port is reachable through the Service, the annotation decides which entrypoint serves this Ingress. Here both agree (`websecure` is exposed, `web` is not), so the annotation is a safeguard that keeps the route HTTPS-only even if `web` is exposed later.
- The `tls` section of the Ingress (secret `tata-labs-tls-prod`) supplies the certificate Traefik uses for TLS on `websecure`.