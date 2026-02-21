FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx esbuild apps/align-api/src/main.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --resolve-extensions=.ts,.tsx,.js,.jsx \
  --outfile=dist/apps/align-api/main.js \
  --tsconfig=apps/align-api/tsconfig.app.json

RUN ls -la dist/apps/align-api/main.js

EXPOSE 3000

CMD ["node", "dist/apps/align-api/main.js"]
