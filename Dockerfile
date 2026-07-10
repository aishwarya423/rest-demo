FROM node:24-alpine

WORKDIR /app

# Copy project files
COPY grafbase.toml .
COPY schema.graphql .
COPY grafbase_extensions ./grafbase_extensions

# Install Grafbase CLI
RUN npm install -g @grafbase/cli

# Expose GraphQL port
EXPOSE 5000

# Run Grafbase dev server
CMD ["grafbase", "dev", "--listen-address", "0.0.0.0:5000"]
