FROM node:22-bookworm-slim
WORKDIR /usr/src/app
COPY actors/intelligence/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY lib/intelligenceCapture.js lib/intelligenceBatch.js ./lib/
COPY actors/intelligence/main.js actors/intelligence/runtime.js ./actors/intelligence/
CMD ["node", "actors/intelligence/main.js"]
