FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build the API
RUN npx nx build align-api --configuration=production --no-daemon

# Expose port
EXPOSE 3000

# Start
CMD ["node", "dist/apps/align-api/main.js"]
