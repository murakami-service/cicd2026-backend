FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev
# Copy source
COPY . .
# Generate Prisma client
RUN npx prisma generate
# Create uploads directory
RUN mkdir -p uploads/avatars uploads/org-chart uploads/events
EXPOSE 3001
# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node src/app.js"]