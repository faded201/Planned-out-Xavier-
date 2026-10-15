FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /opt/xavier-worker
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && mkdir /workspace && chown pwuser:pwuser /workspace
COPY worker.mjs ./
USER pwuser
ENV XAVIER_AGENT_WORKSPACE=/workspace
CMD ["node", "worker.mjs"]
