# TODO

## Migration to https will break on sameOrigin check in origin.go if there is tls termination on the load balancer

#### Background
nginx sets X-Forwarded-Proto $scheme. Behind a TLS-terminating ingress or load balancer, $scheme is http, so the backend sees http while the browser's Origin is https://.... The mismatch comes from nginx overwriting the header, not from the check.

#### Possible solutions

##### Explicit allowlist (most common for production)

Set ALLOWED_ORIGINS=https://labs.example.com per environment, and don't derive trust from request headers at all.
This is robust against any proxy chain. The code already supports it, because the exact-match fallback runs when sameOrigin fails.


##### Trust forwarded headers from your own proxies

Each hop passes the original X-Forwarded-Proto and Host through instead of overwriting them. The backend then derives the public origin from them. This is only safe if the backend is reachable solely through those proxies.
The ingress already sets X-Forwarded-Proto: https and preserves Host. The inner nginx should keep the incoming value and only fall back to $scheme when there is none:

```
map $http_x_forwarded_proto $fwd_proto {
    default $http_x_forwarded_proto;
    ""      $scheme;
}
# in the location block:
proxy_set_header X-Forwarded-Proto $fwd_proto;
```


Ports work out. A browser at https://labs.example.com sends Host: labs.example.com and Origin: https://labs.example.com. Both normalize to port 443, so the check matches.

#### use both?

 Keep the same-origin check with the nginx map fix, so dev and simple setups work with no config, and set ALLOWED_ORIGINS explicitly in production. The allowlist stays valid even if someone later changes the proxy chain.



## Dedicated page per lab (introduces client-side routing)

**Context:** Clicking a lab currently shows the instructions and terminal on the same page (`HomeComponent`), so no routing is needed. The unused `app.routes.ts` / `app.config.ts` scaffolding was removed for this reason.

**Planned change:** clicking a lab opens a dedicated page showing only that lab, e.g. `/labs/:id`. This is the use case for client-side routing:

- Re-add `provideRouter(routes)` in `main.ts` and a `<router-outlet>` in `AppComponent`.
- Routes: `''` for the lab list (`HomeComponent`), `'labs/:id'` for a new lab page with instructions and terminal. Load the lab with `LabService.getLab(id)`.
- nginx already falls back to `index.html` (`try_files ... /index.html`), so deep links and refreshes work. The dev server handles this by default.
- Update `app.component.spec.ts` for the router.

## CI: npm cache strategy inside Docker builds

**Status:** not yet implemented

**Context:** Currently `frontend/Dockerfile` and `backend/Dockerfile` run
`npm ci` / `go mod download` without an explicit build cache mount, so every
Docker build re-downloads dependencies from scratch. This is fine while
builds are fast, but will become a CI bottleneck as dependencies grow.

**Planned fix (when needed):**

Add a BuildKit cache mount to the Dockerfile so package manager caches
persist across builds on the same runner:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
RUN npm run build
```

However, GitHub Actions runners are ephemeral — a fresh VM per run — so a
plain `--mount=type=cache` only helps within a single job, not across
separate workflow runs. To persist cache **across runs on different
runners**, the CI workflow already uses `docker/build-push-action` with the
GitHub Actions cache backend:

```yaml
cache-from: type=gha,scope=backend
cache-to: type=gha,mode=max,scope=backend
```

This uploads/downloads BuildKit cache layers via GitHub's cache storage
service between runs, independent of which physical runner executes the
job.

**Remaining work:** add the `--mount=type=cache` lines to both Dockerfiles
(with the `# syntax=docker/dockerfile:1` directive at the top) so the
`type=gha` cache actually has npm/go module cache contents to persist,
rather than just Docker layer cache.

## CI/Docker: pin images and GitHub Actions by digest, not tag

**Status:** not yet implemented

**Context:** Currently Dockerfiles and `ci.yml` reference images/actions by
mutable tags, e.g.:

```dockerfile
FROM node:20-alpine
FROM nginxinc/nginx-unprivileged:1.27-alpine
```

```yaml
uses: actions/checkout@v4
uses: docker/build-push-action@v6
uses: aquasecurity/trivy-action@0.24.0
```

Tags like `20-alpine` or `@v4` can be repointed by the upstream maintainer
(or, in a worse case, by a compromised account) to a different image/commit
without you knowing — this is a supply-chain risk. Pinning by immutable
digest guarantees the exact same bytes are used every time, and changes only
when you explicitly update the pin.

**Planned fix (when hardening the pipeline):**

- Docker base images: pin with `@sha256:...` digest, e.g.:
  ```dockerfile
  FROM node:20-alpine@sha256:<digest>
  ```
  Get the digest via `docker pull node:20-alpine && docker inspect --format='{{index .RepoDigests 0}}' node:20-alpine`.

- GitHub Actions: pin with commit SHA instead of tag, e.g.:
  ```yaml
  uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
  ```
  Keep the version as a trailing comment for readability. Tools like
  Dependabot/Renovate can auto-update these pinned SHAs via PRs, so you don't
  lose the ability to get updates — you just review them explicitly.

**Trade-off:** more maintenance overhead (need a bot or manual process to
bump digests), so this is worth doing once the pipeline is stable and before
treating it as production-grade, but not essential for early development.


## Hetzner native K8s LoadBalancer via Hetzner CCM (K8s service of type LoadBalancer instead of manually configuring LB and attaching to NodePort service) 

1. Create a Hetzner API token

2. Create the Kubernetes Secret

For the official Hetzner CCM, the basic secret is:

apiVersion: v1
kind: Secret
metadata:
  name: hcloud
  namespace: kube-system
stringData:
  token: YOUR_HETZNER_API_TOKEN

3. Install the CCM (check compatible version)

kubectl apply -f \
https://raw.githubusercontent.com/hetznercloud/hcloud-cloud-controller-manager/v0.0.18/deploy/hcloud-cloud-controller-manager.yaml

Then check:

kubectl -n kube-system get pods

We should see a CCM pod running.

Also:

kubectl -n kube-system logs \
  -l app=hcloud-cloud-controller-manager
4. kubelets need --cloud-provider=external

Because you're using kubeadm rather than a managed Kubernetes service, you need to tell kubelet that an external cloud provider will initialize the node.

On each node:

sudo mkdir -p /etc/systemd/system/kubelet.service.d

Create: /etc/systemd/system/kubelet.service.d/20-external-cloud.conf

[Service]
Environment="KUBELET_EXTRA_ARGS=--cloud-provider=external"

Then:

sudo systemctl daemon-reload
sudo systemctl restart kubelet

Be careful with already existing nodes, check Hetzner docs

5. The Service becomes LoadBalancer

apiVersion: v1
kind: Service
metadata:
  name: labs-frontend
  annotations:
    load-balancer.hetzner.cloud/location: fsn1
spec:
  type: LoadBalancer

  selector:
    app: labs-frontend

  ports:
    - name: http
      port: 80
      targetPort: 80


Kubernetes will allocate a NodePort automatically, for example:

80:30105/TCP


And now:

kubectl get svc labs-frontend

should eventually look like:

NAME            TYPE           CLUSTER-IP       EXTERNAL-IP      PORT(S)
labs-frontend   LoadBalancer   10.104.119.111   1.2.3.4          80:30105/TCP

EXTERNAL-IP is now populated by the CCM. The CCM creates/configures the Hetzner LB and writes its address into the Service status. 