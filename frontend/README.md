# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli)

## Runtime consistency

Local development, CI, and the frontend Docker build are expected to use the
same Node.js runtime contract. The project enforces that contract during npm
install and frontend script execution so version drift fails fast instead of
showing up later as inconsistent build or test behavior.

The enforcement points are:

- [package.json](package.json): defines the expected runtime in `engines`, adds
	a `check:runtime` script, and runs that check before install and before the
	main frontend scripts.
- [.npmrc](.npmrc): sets `engine-strict=true`, so `npm install` and `npm ci`
	fail when the active runtime does not satisfy the declared engines.
- [Dockerfile](Dockerfile): pins the Node.js image used for the frontend build
	stage, so container builds use the same runtime contract.
- [image-pipeline.yml](../.github/workflows/image-pipeline.yml): pins the Node.js
	version used by the GitHub Actions frontend test job.

In practice, this means runtime drift is rejected in three places:

- local npm-based development commands
- GitHub Actions frontend install and test steps
- frontend Docker image builds

