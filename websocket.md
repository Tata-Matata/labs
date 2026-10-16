In `terminal.component.ts`

```typescript
private connect(): void {
    this.socket = new WebSocket(this.buildSocketUrl());
}
```

### **So what is happening at this point?**

Angular is already running in the browser. The application was downloaded from Nginx earlier. Now this code executes inside the browser.

Suppose `buildSocketUrl()` produces:

```text
wss://labs.example.com/api/terminal
```

The browser now starts establishing a **WebSocket connection to Nginx**.

An important detail in this architecture is that there are actually **two network connections**:

```text
Browser                 Nginx                  Go backend
   │                       │                       │
   │──── connection 1 ────>│                       │
   │                       │──── connection 2 ────>│
   │                       │                       │
```

Nginx is a reverse proxy, so it does not simply hand the browser's connection over to Go. Nginx terminates the connection from the browser and creates/maintains a separate connection to the Go backend.

Therefore, the WebSocket upgrade happens on **both connections**.

---

## **WebSocket handshake**

The browser's connection to Nginx initially starts as HTTP.

The browser sends something like:

```http
GET /api/terminal HTTP/1.1
Host: labs.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13
```

The important headers are:

```http
Upgrade: websocket
Connection: Upgrade
```

They mean:

> "I would like to upgrade this HTTP connection to a WebSocket connection."

If Nginx accepts the request, it needs to establish the corresponding WebSocket connection to the Go backend.

This is why Nginx must be configured to proxy the WebSocket upgrade:

```nginx
location /api/terminal {
    proxy_pass http://labs-backend:8080;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Nginx therefore sends a corresponding upgrade request to Go.

Conceptually:

```text
Browser                         Nginx                         Go
   │                              │                            │
   │ HTTP Upgrade request         │                            │
   │─────────────────────────────>│                            │
   │                              │                            │
   │                              │ HTTP Upgrade request       │
   │                              │───────────────────────────>│
   │                              │                            │
   │                              │                    upgrader.Upgrade()
   │                              │                            │
   │                              │<───────────────────────────│
   │                              │   101 Switching Protocols  │
   │<─────────────────────────────│                            │
   │   101 Switching Protocols    │                            │
```

So there are **two separate upgrade operations**:

```text
Browser ── HTTP ──> Nginx
           ↓
       WebSocket
           ↓
        connection 1


Nginx ─── HTTP ───> Go
          ↓
      WebSocket
          ↓
       connection 2
```

The Go backend therefore still needs to call:

```go
conn, err := s.upgrader.Upgrade(w, r, nil)
```

This does **not** mean that Go is upgrading the browser's connection again.

Go is upgrading the **separate Nginx → Go connection**.

---

## **Why are there two connections?**

Nginx is a reverse proxy. It sits between the browser and the backend.

It cannot simply give Go the browser's existing TCP connection.

Instead:

```text
Browser
   │
   │ TCP connection #1
   ▼
 Nginx
   │
   │ TCP connection #2
   ▼
 Go
```

Nginx receives WebSocket frames from the browser on connection #1 and forwards them over connection #2.

Similarly, when Go sends WebSocket frames back:

```text
Go
 │
 │ WebSocket frame
 ▼
Nginx
 │
 │ WebSocket frame
 ▼
Browser
```

From the application's perspective, however, this behaves like one continuous WebSocket communication:

```text
Browser ═══════════════════════════════════ Go
             Nginx in the middle
```

Nginx is essentially acting as a **WebSocket proxy/tunnel** between the two WebSocket connections.

---

# **Complete flow**

First, the browser loads the Angular application using ordinary HTTP:

```text
                    HTTP
Browser ─────────────────────────> Nginx
        GET /main.js                 │
                                     │
        <────────────────────────────┘
                  JavaScript
```

Later, when `new WebSocket(...)` executes, the terminal connection is established:

```text
                    HTTP Upgrade
Browser ─────────────────────────> Nginx
        GET /api/terminal             │
        Upgrade: websocket            │
                                      │
                                      │ HTTP Upgrade
                                      ▼
                                  Go backend
                                      │
                                      │
Browser ═══════════════════════════════╪════════════════ Go
        WebSocket connection #1       │       WebSocket connection #2
                                      │
                         Nginx proxies WebSocket
                         frames between them
```

After the handshake has completed, both connections are long-lived WebSocket connections.

```text
Browser ═════ WebSocket ═════> Nginx ═════ WebSocket ═════> Go
Browser <════ WebSocket ═════= Nginx <════ WebSocket ═════= Go
```

The WebSocket remains open while the terminal session is active.

---

# **Data flow: frontend → backend**

Once the WebSocket is established, we no longer perform an HTTP request for every keystroke.

For example:

```typescript
this.term.onData((data) => this.forwardInput(data));
```

If we press `a`, xterm generates something like:

```text
"a"
```

Angular sends a message over the **already-established WebSocket**:

```typescript
this.socket.send(JSON.stringify({
    type: 'input',
    data: 'a'
}));
```

The message travels through the two WebSocket connections:

```text
Angular
   │
   │ WebSocket message
   ▼
Browser
   │
   │ connection #1
   ▼
Nginx
   │
   │ connection #2
   ▼
Go backend
```

Nginx does not need to understand the application-level message:

```json
{
  "type": "input",
  "data": "a"
}
```

It simply proxies the WebSocket traffic.

The Go backend reads the message from its WebSocket connection and can then write `"a"` to the PTY attached to the lab container.

---

# **Data flow: backend → frontend**

Suppose the user runs:

```text
$ ls
```

The shell produces output:

```text
file1.txt
file2.txt
```

The Go backend reads this output from the PTY and sends a WebSocket message:

```json
{
  "type": "output",
  "data": "file1.txt\nfile2.txt\n"
}
```

The message travels in the opposite direction:

```text
Lab container
     │
     │ PTY output
     ▼
Go backend
     │
     │ WebSocket frame
     ▼
Nginx
     │
     │ WebSocket frame
     ▼
Browser
     │
     │ socket.onmessage
     ▼
Angular
     │
     ▼
xterm.write(...)
```

And in Angular:

```typescript
this.socket.addEventListener('message', (event) => {
    const message = this.parseMessage(event.data);

    if (message.type === 'output' && message.data) {
        this.term.write(message.data);
    }
});
```

---

# **What Nginx actually does**

Nginx is not interpreting the terminal messages.

It mainly provides the connection between the browser and the Go backend:

```text
                    WebSocket connection #1
Browser ═══════════════════════════> Nginx
                                      │
                                      │
                                      │ WebSocket connection #2
                                      ▼
                                  Go backend
```

For example, Angular sends:

```json
{
  "type": "input",
  "data": "ls\n"
}
```

Nginx does not need to understand that this means "run `ls`".

It forwards the WebSocket traffic to Go.

Go understands the application-level protocol:

```text
type = input
data = "ls\n"
```

and decides what to do with it.

Similarly, Go sends:

```json
{
  "type": "output",
  "data": "file1.txt\n"
}
```

Nginx simply proxies it back to the browser.

---

# **WebSocket vs normal HTTP flow**

The WebSocket is **not** used to load the Angular application.

We have two separate kinds of communication.

### 1. Application loading

```text
Browser ──HTTP──> Nginx
Browser <──────── Nginx
          HTML/JS/CSS
```

This consists of ordinary HTTP request/response cycles.

For example:

```text
GET /index.html
GET /main.js
GET /styles.css
```

Once the files have been downloaded, those HTTP requests are finished.

### 2. Terminal interaction

When:

```typescript
new WebSocket(...)
```

executes, a new connection is established:

```text
Browser ── HTTP Upgrade ──> Nginx
                              │
                              │ HTTP Upgrade
                              ▼
                          Go backend
```

After the upgrade:

```text
Browser ══ WebSocket ══> Nginx ══ WebSocket ══> Go
Browser <═ WebSocket ═══ Nginx <═ WebSocket ═══ Go
```

There are therefore **two WebSocket connections**, one on each side of Nginx:

```text
Browser
   │
   │ WebSocket connection #1
   ▼
 Nginx
   │
   │ WebSocket connection #2
   ▼
 Go backend
```

Nginx proxies WebSocket frames between them.

The result is a **long-lived, bidirectional communication channel** from the application's perspective:

```text
Angular ←──────────────────────────────→ Go
                 Nginx
              in the middle
```

This allows terminal input to travel from Angular to the PTY and terminal output to travel back from the PTY to Angular without creating a new HTTP request for every piece of terminal data.