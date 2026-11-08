package main

import (
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// checkOrigin guards the terminal WebSocket against Cross-Site WebSocket Hijacking.
func checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}

	originURL, err := url.Parse(origin)
	if err == nil && originURL.Host != "" && sameOrigin(originURL, r) {
		return true
	}

	for _, allowedOrigin := range splitAndTrim(os.Getenv("ALLOWED_ORIGINS")) {
		if origin == allowedOrigin {
			return true
		}
	}

	return false
}

func sameOrigin(origin *url.URL, r *http.Request) bool {
	scheme := strings.ToLower(origin.Scheme)
	if scheme != requestScheme(r) {
		return false
	}

	reqHost, reqPort := splitHostPort(r.Host)
	if reqPort == "" {
		reqPort = defaultPort(scheme)
	}

	originPort := origin.Port()
	if originPort == "" {
		originPort = defaultPort(scheme)
	}

	return strings.EqualFold(origin.Hostname(), reqHost) && originPort == reqPort
}

// X-Forwarded-Proto is trusted because the backend is only reachable through the proxy.
func requestScheme(r *http.Request) string {
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		return strings.ToLower(strings.TrimSpace(strings.Split(proto, ",")[0]))
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func splitHostPort(hostport string) (string, string) {
	if host, port, err := net.SplitHostPort(hostport); err == nil {
		return host, port
	}
	return strings.Trim(hostport, "[]"), ""
}

func defaultPort(scheme string) string {
	if scheme == "https" {
		return "443"
	}
	return "80"
}
