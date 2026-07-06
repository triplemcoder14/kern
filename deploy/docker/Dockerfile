# Runtime image — build the API before deploy: npm run build --prefix api
# (deploy-docker.sh does this automatically)

FROM node:22-alpine

WORKDIR /kern/api

COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev

COPY api/dist ./dist

EXPOSE 3000

CMD ["node", "dist/api/src/main.js"]
