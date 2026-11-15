## Components

| Component | Purpose |
|------------|--------------|
| Hetzner DNS | domain name resolution
| Hetzner Cloud Load Balancer | public entry point
| Kubernetes NodePort | expose the ingress controller on worker nodes
| Traefik |  Kubernetes ingress controller and TLS termination point
| cert-manager  | automated certificate lifecycle management
| Let's Encrypt | public Certificate Authority (CA)
| Hetzner DNS webhook | integrate cert-manager with Hetzner's DNS API

Kubernetes Services that expose the application deployments remain all ClusterIP, not directly exposed outside the cluster.

## High-level architecture
```
                        PUBLIC INTERNET
                                |
                                |
                      Browser / HTTPS client
                                |
                                |
                     tata-labs.com:443
                                |
                                |
                       Hetzner DNS
                      A record: IPv4
                                |
                                |
                                v
                   Hetzner Cloud Load Balancer
                         Public IPv4
                         Port: 443
                         Protocol: TCP
                                |
                                |
                         TCP forwarding
                                |
                                v
                    Kubernetes Worker Nodes
                          NodePort 30443
                                |
                                |
                                v
                       Traefik Service
                         NodePort
                         Port: 443
                         Target: 8443
                                |
                                |
                                v
                       Traefik Pods
                     TLS termination
                                |
                                |
                       HTTPS decrypted
                                |
                                |
                                v
                     labs-frontend Service
                         ClusterIP
                         Port: 80
                                |
                                |
                         targetPort: 8080
                                |
                                |
                                v
                       Frontend Pod
                         Port: 8080
```


## cert-manager: Obtaining and renewing TLS certificate

```
                      cert-manager
                            |
                            |
                    Certificate resource
                            |
                            |
                       ClusterIssuer
                            |
                            |
                       ACME protocol
                            |
                            v
                       Let's Encrypt
                            |
                            |
                   DNS-01 challenge issued
                            |
                            v
                  cert-manager webhook
                            |
                            |
                  Hetzner DNS API token
                            |
                            |
                            v
                       Hetzner DNS
                     TXT record created
                            |
                            |
                   Let's Encrypt checks
                   DNS TXT record
                            |
                            |
                     Domain validated
                            |
                            v
                  Certificate issued
                            |
                            |
                    Kubernetes Secret
                            |
                            |
                            v
                       Traefik
```

## Domain and DNS configuration

The domain tata-labs.com is registered with Hetzner. The DNS zone is managed through Hetzner DNS Console, in a separate Hetzner Cloud project. The nameservers (listed in section NS in DNS zone configuration in Hetzner portal) are responsible for answering authoritative DNS queries for the domain.

#### DNS records
The final configuration uses an A record that maps the domain name to the load balancer's public IP. The A record tells DNS resolvers which IPv4 address to use when a client requests tata-labs.com.

IPv6 AAAA records removed for now as not required: An AAAA record should only be published if the service actually supports IPv6 at that address. IPv6 is not configured on the Load Balancer, so we do not publish an AAAA record pointing to it.

#### Some useful troubleshooting commands

```
# Query the A record
dig A tata-labs.com

# Query the AAAA record
dig AAAA tata-labs.com

# Query authoritative Hetzner DNS
dig @ns1.your-server.de AAAA tata-labs.com

# Query Cloudflare DNS
dig @1.1.1.1 AAAA tata-labs.com

# Flush local systemd-resolved cache
sudo resolvectl flush-caches
```

## DNS-01 validation

Before obtaining a publicly trusted TLS certificate, a Certificate Authority needs to verify that the requester controls the domain.

Let's Encrypt supports several validation methods. The two most commonly encountered are: HTTP-01 and DNS-01

### HTTP-01 validation

With HTTP-01, Let's Encrypt asks the domain owner to serve a specific challenge response over HTTP.

The process looks approximately like this:

1. cert-manager requests a certificate.
2. Let's Encrypt issues a challenge.
3. cert-manager configures an HTTP challenge responder.
4. Let's Encrypt connects to the domain over HTTP, normally port 80.
5. It checks the challenge response.
6. If successful, the certificate can be issued.
7. This requires the domain to be reachable over HTTP on port 80.

We did not choose this method because the intention was to expose the application over HTTPS only.

### DNS-01 validation

DNS-01 proves domain ownership by creating a specific **TXT record** in the domain's DNS zone.

The process:

1. cert-manager creates a **CertificateRequest**.
2. The **ACME Issuer** creates an **ACME Order** with Let's Encrypt.

**Order** and **Challenge** are Kubernetes custom resources provided by cert-manager's ACME implementation. cert-manager creates and manages them to track the ACME protocol state.

**ClusterIssuer** resource that we deployed is the Kubernetes resource that configures cert-manager to communicate with Let's Encrypt.

3. Let's Encrypt returns an order containing one or more authorizations and challenges.
4. cert-manager creates a Kubernetes **Challenge** resource for the DNS-01 challenge.
5. The challenge controller calculates the required DNS-01 response.
6. The challenge controller asks the Hetzner DNS provider integration (s. cert-manager-webhook-hetzner deployment in cert-manager ns) to create the TXT record.
7. cert-manager waits until the TXT record is publicly visible.
8. cert-manager tells Let's Encrypt to validate the challenge.
9.  Let's Encrypt queries DNS and verifies the TXT record.
10.  The ACME challenge becomes valid, and the **Order** becomes ready.
11.  cert-manager finalizes the **Order**, submitting the **certificate signing request**.
12.  Let's Encrypt issues the certificate.
13. cert-manager stores the certificate and private key in a Kubernetes **Secret**.

The TXT record is created under:

```
_acme-challenge.tata-labs.com
```

After validation, the temporary challenge record is cleaned up.

### How to observe this in Kubernetes

```
kubectl get certificaterequests -A
kubectl get orders -A
kubectl get challenges -A
```

For a more detailed view:

```
kubectl describe order <order-name> -n <namespace>
kubectl describe challenge <challenge-name> -n <namespace>
```

### ClusterIssuer

This resource tells cert-manager:
- Which ACME server to use (Let's Encrypt).
- Which email address to register.
- Where to store the ACME account private key.
- How to solve challenges (DNS-01 using Hetzner).

cert-manager watches your ClusterIssuer resource. 
When we first deploy a **Certificate** resource, cert-manager detects that a certificate is needed. cert-manager notices that the target Secret doesn't contain a valid certificate and starts the issuance process. 

**cluster-scoped**: certificates in different namespaces can reference the same ClusterIssuer.

cert-manager also continuously monitors issued certificates. For Let's Encrypt certificates, which typically have a 90-day validity, cert-manager normally attempts renewal around 30 days before expiration (unless configured otherwise).

cert-manager uses the configuration from that resource to communicate with Let's Encrypt.
It then:
1. Registers or uses an existing ACME account.
2. Creates an ACME Order through the Let's Encrypt API.
3. Processes the challenges associated with that Order.
4. Finalizes the Order after successful validation.

| Component | Purpose |
|------------|--------------|
| ClusterIssuer | Kubernetes custom resource containing configuration
| ACME Issuer | cert-manager logic implementing the ACME protocol
| ACME Order | Kubernetes resource tracking a certificate order
| Challenge |  Kubernetes resource tracking a DNS-01 or HTTP-01 challenge


##### privateKeySecretRef in ClusterIssuer

privateKeySecretRef refers to a Kubernetes Secret containing the private key of your ACME account registered with Let's Encrypt.

```
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: nikolaevata@pm.me
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
```

This tells cert-manager:
- Create (if it doesn't exist) a Kubernetes Secret named letsencrypt-prod-account-key.
- Store the ACME account private key there.
- Use this key to authenticate your ACME account when communicating with Let's Encrypt.


##### tokenSecretKeyRef in ClusterIssuer

references a Kubernetes Secret containing your Hetzner DNS API authentication token.

cert-manager needs this token because it must be able to programmatically create and delete DNS records in your Hetzner DNS zone.

```
solvers:
  - dns01:
      webhook:
        groupName: acme.hetzner.com
        solverName: hetzner
        config:
          tokenSecretKeyRef:
            name: hetzner
            key: token
```


##### secretName in Certificate
the key generated for the domain certificate
cert-manager stores the issued certificate and its corresponding private key in the Secret.

This is the key that Ingress controller uses for TLS termination.

```
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: tata-labs-production
  namespace: labs
spec:
  secretName: tata-labs-tls-prod
```

```
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - tata-labs.com
      secretName: tata-labs-tls-prod
```


### DNS-01 has several advantages

1. No public HTTP endpoint is required.
2. No public port 80 is required.
3. It works even when the application is not publicly accessible.
4. It can also validate wildcard certificates, such as *.tata-labs.com.
5. It separates certificate ownership validation from application traffic routing.

## cert-manager

Kubernetes certificate lifecycle management controller. Without cert-manager, we would have to manually request certificates, manage private keys, create TLS Secrets, and replace certificates when they expire. cert-manager watches Kubernetes resources and performs the necessary operations.

### Installation

```
helm install cert-manager \
  oci://quay.io/jetstack/charts \
  --version v1.21.3 \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true
```

The installation creates three main components: 

| Component | Purpose |
|------------|--------------|
| cert-manager controller | Watches resources and manages certificate issuance
| cert-manager webhook | Validates and manages cert-manager API resources
| cert-manager cainjector | Injects CA bundles into relevant Kubernetes resources

The cert-manager controller is the main component responsible for the certificate lifecycle. The webhook is cert-manager's own Kubernetes admission webhook. It is different from the Hetzner DNS webhook.

## Hetzner DNS webhook

cert-manager supports different DNS providers, but it does not automatically know how to communicate with every DNS provider's API. The DNS provider integration is responsible for creating and deleting DNS TXT records.

The Hetzner DNS webhook provides the integration between cert-manager and the Hetzner DNS API. Its responsibility is to translate cert-manager's DNS challenge operations into Hetzner API calls.

```
cert-manager
     |
     | DNS challenge request
     v
Hetzner DNS webhook
     |
     | HTTPS API request
     v
Hetzner DNS API
     |
     v
DNS TXT record created
```

#### Hetzner API token

We created an API token in the Hetzner Cloud project containing the DNS zone.
The token allows the webhook to manage DNS records through the Hetzner API.
We stored it in Kubernetes as a Secret in the cert-manager namespace:

```
read -rsp "Hetzner API token: " HETZNER_TOKEN
echo

kubectl create secret generic hetzner \
  --namespace cert-manager \
  --from-literal=token="$HETZNER_TOKEN"

unset HETZNER_TOKEN
```

The webhook references this Secret when it needs to authenticate against the Hetzner DNS API.


#### Webhook configuration

The ClusterIssuer references the webhook using:

```
solvers:
  - dns01:
      webhook:
        groupName: acme.hetzner.com
        solverName: hetzner
        config:
          tokenSecretKeyRef:
            name: hetzner
            key: token
```

The important fields are:

**groupName**: identifies the API group registered by the webhook.
**solverName**: identifies the DNS solver implementation.
**tokenSecretKeyRef**: tells the webhook which Kubernetes Secret contains the API token. The values must match the installed webhook's configuration.

## Certificate

The Certificate resource tells cert-manager what certificate we want.

It specifies:

1. The DNS names the certificate must cover.
2. Which ClusterIssuer should issue it.
3. The name of the Kubernetes Secret where the result should be stored.

### What happens after applying the Certificate?

cert-manager detects it and starts the issuance process.
Internally, cert-manager creates and manages additional resources, including:

- CertificateRequest
- Order
- Challenge

These resources represent the different stages of the ACME protocol.

The general lifecycle is:

```
Certificate
    |
    v
CertificateRequest
    |
    v
ACME Order
    |
    v
ACME Challenge
    |
    v
DNS-01 validation
    |
    v
Certificate issued
    |
    v
TLS Secret created
```

The final Secret contains:

- tls.crt: certificate and certificate chain.
- tls.key: corresponding private key.

Its type is: kubernetes.io/tls

## Traefik ingress controller

We installed Traefik using its Helm chart. Repository: https://traefik.github.io/charts


Traefik is responsible for:

- Watching Kubernetes Ingress resources.
- Configuring HTTP and HTTPS routers.
- Selecting the appropriate backend Service.
- Terminating TLS.
- Forwarding requests to application backends.

We configured Traefik as a NodePort Service.
This means:

Kubernetes Service port: 443

NodePort: 30443

Traefik container entrypoint: 8443

The mapping is:

```
NodePort 30443
      |
      v
Service port 443
      |
      v
Traefik container port 8443
```
The HTTP entrypoint is not exposed through the Traefik Service. The HTTPS entrypoint is exposed. S. configuration in traefik-values.yaml

The Hetzner Load Balancer forwards incoming traffic to that NodePort.

The resulting architecture is:

```
Hetzner Load Balancer
       |
       | TCP 443
       v
Worker node
       |
       | TCP 30443
       v
Traefik
```

With the default Kubernetes Service traffic policy (externalTrafficPolicy: Cluster), traffic arriving at a node can be forwarded to a Traefik pod on another node if necessary.

This also means the Load Balancer does not need to target only nodes currently running a Traefik pod.

#### Why the Load Balancer uses TCP rather than HTTPS

The Hetzner Load Balancer forwards TCP traffic on port 443 to the Kubernetes NodePort 30443.

Its configuration is:

| Setting | Value | 
|------------|--------------|
| Protocol | TCP |
| Public port | 443 |
| Target port | 30443 |
| Target nodes | Kubernetes worker nodes |
| Health check | TCP |
| Health check port | 30443 |

Why TCP?

Because **TLS termination happens at Traefik**, not at the Load Balancer. The Load Balancer does not need to understand the HTTPS protocol or inspect the certificate. **It simply forwards the encrypted TCP connection.**
TLS termination is at the ingress controller.

#### Alternative: TLS termination at the Load Balancer

Another possible architecture would be:

```
Browser
   |
   | HTTPS
   v
Hetzner Load Balancer
   |
   | TLS termination
   v
Traefik
   |
   v
Application
```

However, this would require configuring the certificate at the Load Balancer.
It would also mean deciding whether the connection from the Load Balancer to Traefik should use HTTP or a second HTTPS connection.

We chose not to do that.

Our certificate lifecycle is managed inside Kubernetes, and Traefik is responsible for TLS termination.

## Kubernetes Ingress
defines how incoming requests should be routed.

#### TLS configuration

```
tls:
  - hosts:
      - tata-labs.com
    secretName: tata-labs-tls
```

This tells Traefik which TLS Secret to use for this hostname.
The Secret must exist in the same namespace as the Ingress.

Traefik loads the certificate and private key from this Secret. When a browser connects to tata-labs.com, Traefik presents the certificate.

## Troubleshooting

During implementation, we encountered several issues. They are useful examples of how to troubleshoot this architecture layer by layer.

###  Certificate issued, but browser shows the wrong certificate

**Symptom**:

```
Common Name (CN): your-server.de
```

**Cause**:

The browser was connecting to the old server through the stale IPv6 AAAA record.

**Solution**:

Delete the obsolete AAAA record and wait for DNS caches to expire.

**Useful commands**:

```
dig A tata-labs.com
dig AAAA tata-labs.com

curl -4 -v https://tata-labs.com
curl -v https://tata-labs.com
```

#### Certificate is self-signed

**Symptom**:

SSL certificate problem: self-signed certificate

**Likely cause:**

Traefik was presenting its default certificate instead of the requested certificate.

**Possible reasons:**

- The Ingress references the wrong Secret. 
- The Secret does not exist.
- The Ingress references a Secret in another namespace.
- The Ingress is not being handled by Traefik.

**Check**:
```
kubectl get ingress -n labs
kubectl describe ingress labs-frontend -n labs

kubectl get secret tata-labs-tls -n labs
kubectl get certificate -n labs
```

### Ingress reports that a Service cannot be found

**Symptom**:

services "labs-frontend" not found

**Cause**:

- The Ingress and Service were in different namespaces.
- Kubernetes Ingress backends reference Services in the same namespace.


### Certificate is valid, but browser still reports an error

Always inspect the actual certificate presented by the endpoint.

```
openssl s_client \
  -connect tata-labs.com:443 \
  -servername tata-labs.com \
  -showcerts </dev/null
```

For a concise certificate inspection:
```
echo | openssl s_client \
  -connect tata-labs.com:443 \
  -servername tata-labs.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Also remember that DNS caching can cause a client to reach an old server even after the DNS zone has been corrected.

### Check the complete request path

When troubleshooting, verify each layer separately:

| Layer | What to verify | 
|------------|--------------|
| DNS | Correct A record and no stale AAAA record |
| Load Balancer | Public port 443 and correct targets |
| NodePort |  Traefik reachable on 30443 |
| Traefik |  Pods running and Service correctly configured |
| Ingress | Correct class, hostname and backend |
| TLS | Correct Secret in the Ingress namespace |
| cert-manager |  Certificate Ready=True |
| Application Service |  Correct port and targetPort |
| EndpointSlice |  Healthy backend pod addresses |

## Important Kubernetes resources

| Resource | Namespace |  Purpose |
|------------|--------------|------|
| ClusterIssuer `letsencrypt-prod` | Cluster-scoped | Defines production ACME configuration |
| Secret `hetzner` | cert-manager | Stores Hetzner API token |
| Secret `letsencrypt-prod-account-key` | cert-manager | Stores ACME account private key |
| Certificate `tata-labs-production` | labs | Requests the domain certificate |
| Secret `tata-labs-tls-prod` | labs | Stores TLS certificate and private key |
| Ingress `labs-frontend` | labs | Defines public HTTPS routing |
| IngressClass `traefik` | Cluster-scoped | Identifies the ingress controller |
| Service `traefik` | traefik | Exposes Traefik through NodePort |
| Service `labs-frontend` | labs | Internal frontend Service |


## Useful concepts

| Concept | What it actually does |
|---------|-----------------------|
| A record | Maps a hostname to an IPv4 address |
| AAAA record | Maps a hostname to an IPv6 address |
| TXT record | Stores arbitrary text in DNS; used here for domain validation |
| DNS-01 | ACME domain ownership validation using a TXT record |
| ACME | Protocol used to automate certificate issuance |
| Let's Encrypt | Public Certificate Authority |
| ClusterIssuer | cert-manager configuration for obtaining certificates |
| Certificate | Kubernetes declaration of the certificate we want |
| CertificateRequest | Internal cert-manager resource representing a certificate request |
| TLS Secret | Stores the actual certificate and private key |
| DNS webhook | Connects cert-manager to the DNS provider API |
| Ingress | Defines host/path routing rules |
| IngressClass | Identifies the ingress controller |
| Traefik | Implements the routing and TLS termination |
| NodePort | Exposes a Kubernetes Service on a node port |
| Load Balancer | Provides the public network entry point |

