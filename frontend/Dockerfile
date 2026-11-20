FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vacío = el emisor OIDC es <origen>/realms/sses (D38)
ARG VITE_OIDC_AUTHORITY=
ARG VITE_API_URL=/api/v1
ARG VITE_DEMO=1
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY VITE_API_URL=$VITE_API_URL VITE_DEMO=$VITE_DEMO
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
