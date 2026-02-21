FROM node:20-alpine

WORKDIR /app

# Copy package files and install ALL dependencies (needed for build)
COPY package*.json ./
RUN npm install

# Copy all source
COPY . .

# Build using esbuild directly — same tool NX uses under the hood.
# Bypasses NX daemon/cache issues in CI environments.
# --bundle + --tsconfig resolves @cav-align/core and other path aliases.
RUN npx esbuild apps/align-api/src/main.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --outfile=dist/apps/align-api/main.js \
  --tsconfig=apps/align-api/tsconfig.app.json

# Verify the output exists — build fails here if something went wrong
RUN ls -la dist/apps/align-api/main.js

EXPOSE 3000

CMD ["node", "dist/apps/align-api/main.js"]
