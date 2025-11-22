# Use official lightweight Node.js image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm install 

# Copy all source code
COPY . .

# Build TypeScript (using ts-node)
RUN npm run build

# Expose Cloud Run port
EXPOSE 8080

# Start the app directly with ts-node
CMD ["npm", "start"]

