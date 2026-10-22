# Apify's Playwright image already contains Chrome. The tag pins Node 22 and Playwright 1.56.0, which must match package.json.
FROM apify/actor-node-playwright-chrome:22-1.56.0
COPY --chown=myuser:myuser actors/intelligence/package.json ./package.json
RUN npm install --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force
COPY --chown=myuser:myuser lib/intelligenceCapture.js lib/intelligenceBatch.js lib/intelligenceBrowser.js lib/intelligenceDiscover.js ./lib/
COPY --chown=myuser:myuser actors/intelligence/main.js actors/intelligence/runtime.js ./actors/intelligence/
CMD ["node", "actors/intelligence/main.js"]
