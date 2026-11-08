# Trivy file scan vs Trivy image scan

We have jobs in the pipeline that scan

- frontend source directories
- backend source directories
- frontend image
- backend image


## Filesystem scan (trivy fs)

Can detect:


- Vulnerable dependencies: 	A vulnerable version of a Go module
- Vulnerable npm packages:	A vulnerable version of zod
- Misconfigurations:	Certain insecure configuration files
- Secrets:	Accidentally committed API keys or credentials
- License issues	Depending on your configuration


It can detect vulnerable dependencies without requiring to build a Docker image.

## Image scan (trivy image)

Detects:

- OS package vulnerabilities:	Vulnerable Alpine packages
- Application dependencies:	Vulnerable npm or Go dependencies included in the image
- Image configuration:	Certain container configuration issues
- Embedded binaries:	Vulnerable software included in the image


It tells you what is actually shipped in your container.

## Why both matter: Example

- trivy fs scans your package-lock.json.
- trivy image scans the resulting Nginx image.
  
Suppose **package.json** contains a vulnerable npm dependency.

However, your Dockerfile uses a multi-stage build, and the final Nginx image only contains the compiled Angular application.

Depending on the dependency and build process, that vulnerable package might not be present in the final image.

The filesystem scan can still identify it.

The reverse is also true: your filesystem scan won't necessarily detect an Alpine vulnerability introduced by your Nginx base image.