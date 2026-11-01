ARG BASE_IMAGE
FROM node:26.10.0-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx-unprivileged listens on port 8080 by default and runs as a non-root
# user (uid 101), satisfying Kubernetes runAsNonRoot / non-privileged port
# requirements.
FROM ${BASE_IMAGE}
USER root
RUN apk upgrade --no-cache libexpat
ENV BACKEND_HOST=labs-backend
ENV BACKEND_PORT=8080
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
USER 101
EXPOSE 8080
