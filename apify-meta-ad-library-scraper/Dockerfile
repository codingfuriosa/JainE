# Apify's official Playwright + Chromium base image (Node 20)
FROM apify/actor-node-playwright-chrome:20

# Install dependencies (production only)
COPY --chown=myuser:myuser package*.json ./
RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional \
 && (npm list --omit=dev --all || true)

# Copy the rest of the source
COPY --chown=myuser:myuser . ./

CMD ["npm", "start", "--silent"]
