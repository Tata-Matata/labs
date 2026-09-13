FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx-unprivileged listens on port 8080 by default and runs as a non-root
# user (uid 101), satisfying Kubernetes runAsNonRoot / non-privileged port
# requirements.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
