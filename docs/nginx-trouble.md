## 1. nginx isn't running


<details>
<summary>Answer</summary>
curl localhost:80 outputs connection refused

### Investigation
ps aux
systemctl status nginx
systemctl start nginx

### Cause:

nginx.service is stopped

</details>

## 2. nginx is installed but disabled


<details>
<summary>Answer</summary>
curl localhost:80 outputs connection refused

### Investigation
systemctl status nginx
systemctl enable nginx
systemctl start nginx

### Cause:

nginx.service is stopped

</details>


## 3. nginx isn't installed


<details>
<summary>Answer</summary>
curl localhost:80 outputs connection refused

### Investigation
systemctl status nginx  Unit nginx.service could not be found.
which nginx
nginx -v
dpkg -l | grep nginx

### Solution

install

</details>

## 4. nginx process starts and immediately exits

<details>
<summary>Answer</summary>
curl localhost:80 outputs connection refused

### Investigation
systemctl start nginx
systemctl status nginx

journalctl -u nginx
nginx -t

### Cause
For example, you deliberately introduce:

server {
    listen 80
    server_name example.com;
}

missing the semicolon.
</details>

## 5. nginx configuration file is in an unexpected location

<details>
<summary>Answer</summary>
curl localhost:80 outputs connection refused

the configuration is valid, but the user has to discover where it lives

### Investigation
nginx -V
ps aux | grep nginx
find /etc -name '*nginx*'


</details>

## 6. nginx is running, but listening on the wrong port

<details>
<summary>Answer</summary>
curl localhost:80 outputs connection refused

the configuration is valid, but the user has to discover where it lives

### Investigation
ss -lntp

Then investigate the configuration and correct the port.

</details>

## 7. nginx is running but bound only to localhost

<details>
<summary>Answer</summary>
curl localhost works but curl <container-ip> fails

127.0.0.1:80 instead of: 0.0.0.0:80

### Investigation
service is not reachable through the expected interface

</details>

## 8. nginx is listening, but another process owns port 80

<details>
<summary>Answer</summary>

apache2 → :80
nginx   → cannot bind :80


### Investigation
ss -lntp
lsof -i :80
systemctl status apache2


</details>

## 9. nginx configuration references a missing file

<details>
<summary>Answer</summary>

include /etc/nginx/conf.d/application.conf;

### Investigation

nginx -t
find /etc -name '*.conf'


</details>

## 10. nginx configuration has a permissions problem

<details>
<summary>Answer</summary>

nginx → cannot read /some/config/file

### Investigation
ls -l
namei -l
sudo -u nginx cat <file>

</details>



## 11. nginx cannot read its document root

<details>
<summary>Answer</summary>

The service starts, but requests produce: 403 Forbidden

### Investigation
ls -ld
namei -l
and nginx logs.

</details>

## 12. nginx is running but DNS is wrong

<details>
<summary>Answer</summary>

curl http://myapp.local fails

### Investigation
getent hosts myapp.local
dig myapp.local
cat /etc/resolv.conf

</details>


## 13. nginx is running but the upstream application isn't

<details>
<summary>Answer</summary>

client
  ↓
nginx :80
  ↓
backend :8080

nginx itself is healthy, but: backend isn't running
502 Bad Gateway

### Investigation
curl localhost
systemctl status nginx
cat nginx config
curl localhost:8080
ss -lntp  nothing on 8080

</details>


## 14. Upstream is running but on the wrong port

<details>
<summary>Answer</summary>

backend → :9090
nginx   → proxy_pass :8080

### Investigation
ss

</details>


## 15. nginx can reach the upstream, but DNS resolution of upstream fails
<details>
<summary>Answer</summary>

proxy_pass http://backend:8080;
backend doesn't resolve.

### Investigation
getent hosts backend
cat /etc/resolv.conf

</details>

## 16. nginx is blocked by a firewall

<details>
<summary>Answer</summary>
Everything looks correct locally, but remote access fails.
LISTEN 0.0.0.0:80


### Investigation
ss -lntp
ip addr
ip route
iptables -L -n -v
nft list ruleset

</details>

## 17. nginx is running in a container but port isn't published

<details>
<summary>Answer</summary>
ss -lntp
curl localhost:80
works inside container

From outside: curl <host>:80 fails.
The problem is the container networking configuration.


</details>

## 18. Kubernetes Service points to the wrong port
<details>
<summary>Answer</summary>

This is where your labs could become much more interesting.

pod is exposing nginx on 8080 but the Service targets: targetPort: 80

The nginx container is perfectly healthy. The Kubernetes abstraction is broken.

The user has to investigate:

</details>


## 19. Kubernetes readiness probe is wrong

<details>
<summary>Answer</summary>

nginx is running perfectly: curl localhost 200

but Kubernetes says: READY 0/1

because the probe is checking: /health

while nginx only serves: /
</details>

## 20. NetworkPolicy blocks access to nginx

<details>
<summary>Answer</summary>
nginx is: Running
Listening Service configured correctly
Endpoints exist

but traffic still doesn't arrive.

The problem is NetworkPolicy
</details>

## 21.  Ingress is routing to the wrong Service

<details>
<summary>Answer</summary>

Internet
   ↓
LoadBalancer
   ↓
Ingress
   ↓
Service
   ↓
nginx

The user gets:

404
502
connection timeout

and needs to trace the request through the entire chain.
</details>