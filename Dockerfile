FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY src src
COPY ui ui
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATA_FILE=/data/tools.db NODE_NO_WARNINGS=1
EXPOSE 8080
CMD ["node", "src/server.mjs"]
