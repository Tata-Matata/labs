# Labs

Labs is a platform for provisioning hands-on lab environments for practicing
technical skills, initially with a strong focus on troubleshooting Linux environments and container related issues. 

The broader goal is to support realistic exercises across DevOps and
infrastructure topics, including:

- Kubernetes
- Linux
- Terraform
- Ansible
- CI/CD workflows
- container tooling
- general troubleshooting and operational debugging

## What this repository contains

This repository currently includes the core application and deployment assets needed to serve lab content:

- a Go backend that serves lab definitions from PostgreSQL
- an Angular frontend that displays the labs to the learner
- container build and publishing workflows
- Kubernetes manifests for deploying the stack

## Current architecture

At the moment, the application is split into three runtime services:

- `labs-frontend`: serves the web UI
- `labs-backend`: serves the API and reads lab content from PostgreSQL
- `labs-postgres`: stores lab metadata

The frontend talks to the backend through `/api`, and the backend reads its
connection details from environment configuration. The browser terminal is backed by a websocket stream that the backend bridges into the `labs-shell`
pod via Kubernetes `pods/exec`.

## Repository layout

- [backend](backend): Go API server
- [frontend](frontend): Angular application and frontend container build
- [db](db): database initialization SQL
- [k8s](k8s): Kubernetes manifests for the current deployment shape
- [expose](expose): Traefik Helm values, Ingress, and cert-manager manifests for public HTTPS access
- [expose.md](expose.md): documentation of the public exposure and TLS setup
- [.github/workflows](.github/workflows): CI, release, and reusable image
  pipeline workflows
- [local-db](local-db): local PostgreSQL helper assets

## Kubernetes focus

The project is intended to grow into a system that can provision or represent lab environments for operational practice, especially around Kubernetes and Linux troubleshooting. That includes scenarios such as:

- diagnosing broken workloads and failing pods
- investigating service-to-service communication issues
- debugging ingress, DNS, and networking problems
- verifying configuration drift and rollout behavior
- understanding how application, database, and cluster layers interact

Over time, the same model can be extended to Terraform, and other
DevOps tooling so labs can cover both cluster-level and system-level
troubleshooting.

## Deployment

The repository includes:

- reusable GitHub Actions workflows for build, test, scan, and publish
- release automation for versioned images
- Kubernetes manifests under [k8s](k8s) for a simple single-replica deployment

The current Kubernetes manifests are intentionally simple and are suitable as a base for further environment automation and future release-driven manifest updates.

## Public access and TLS

The application is published at `tata-labs.com` over HTTPS only. It is still in development, so `tata-labs.com` might not always serve it. The setup is:

- Hetzner DNS (A record) points the domain to a Hetzner Cloud Load Balancer, which forwards TCP port 443 to NodePort `30443` on the worker nodes
- Traefik (ingress controller, installed with Helm using [expose/traefik-values.yaml](expose/traefik-values.yaml)) terminates TLS and routes to the `labs-frontend` Service through an Ingress
- cert-manager obtains and renews the Let's Encrypt certificate using DNS-01 validation through the Hetzner DNS webhook
- application Services stay `ClusterIP` and are not exposed directly

See [expose.md](expose.md) for the full architecture and troubleshooting notes, and [expose/traefic.md](expose/traefic.md) for the Traefik configuration.

## Related infrastructure repository

The application infrastructure is provisioned from a separate repository:

- [Tata-Matata/k8s-infra](https://github.com/Tata-Matata/k8s-infra): Terraform   and Ansible automation for provisioning and configuring the Kubernetes cluster on Hetzner Cloud

That repository is responsible for the underlying cluster and node
infrastructure, while this repository contains the application, container
images, CI/release workflows, and Kubernetes workload manifests.