FROM node:26.8.2-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx-unprivileged listens on port 8080 by default and runs as a non-root
# user (uid 101), satisfying Kubernetes runAsNonRoot / non-privileged port
# requirements.
FROM nginxinc/nginx-unprivileged:stable-alpine3.24@sha256:4714e0b1b2577eaa1a6131d07c958b67f0eb68e6d0521e90c6e5287db8cf0bc5
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
