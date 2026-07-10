FROM nginx:alpine

# Remove default nginx static assets and config
RUN rm -rf /usr/share/nginx/html/*

# Custom nginx config (listen on 8080)
COPY nginx.conf /etc/nginx/nginx.conf

# Single-page GraphiQL explorer — no build step needed
COPY index.html /usr/share/nginx/html/index.html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
