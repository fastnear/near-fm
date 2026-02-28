FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CONTRACT_ID
ARG NEXT_PUBLIC_NEAR_NETWORK
ARG NEXT_PUBLIC_FASTFS_RECEIVER

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CONTRACT_ID=$NEXT_PUBLIC_CONTRACT_ID
ENV NEXT_PUBLIC_NEAR_NETWORK=$NEXT_PUBLIC_NEAR_NETWORK
ENV NEXT_PUBLIC_FASTFS_RECEIVER=$NEXT_PUBLIC_FASTFS_RECEIVER

RUN npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public

EXPOSE 3847
CMD ["npm", "start"]
