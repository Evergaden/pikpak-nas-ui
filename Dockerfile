FROM rclone/rclone:1.75.0 AS rclone
FROM node:22-alpine

RUN apk add --no-cache ca-certificates tini
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
WORKDIR /app
COPY server/server.js /app/server.js
COPY dist/client /app/web

ENV NODE_ENV=production PORT=8080 CONFIG_DIR=/config DOWNLOAD_DIR=/downloads WEB_DIR=/app/web MAX_CONCURRENT=2
VOLUME ["/config", "/downloads"]
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/server.js"]
