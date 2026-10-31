# Dockerfile for nextjs-basic example app
# Builds QB64, compiles BASIC routes, then runs the Next.js app.
#
# Build args:
#   QB64_VERSION — QB64-PE release tag, e.g. "v3.14.0" (default: v3.14.0)

FROM ubuntu:22.04 AS base

ARG QB64_VERSION=v3.14.0
ENV DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# System deps: Node.js, GCC (required by QB64), curl, unzip
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    gcc \
    g++ \
    make \
    libgl1-mesa-dev \
    libasound2-dev \
    libx11-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Install QB64-PE (headless, Linux x86_64 build)
# ---------------------------------------------------------------------------
RUN curl -fsSL \
    "https://github.com/QB64-Phoenix-Edition/QB64pe/releases/download/${QB64_VERSION}/qb64pe_lnx.tar.gz" \
    -o /tmp/qb64.tar.gz \
    && mkdir -p /opt/qb64 \
    && tar -xzf /tmp/qb64.tar.gz -C /opt/qb64 --strip-components=1 \
    && rm /tmp/qb64.tar.gz

ENV QB64_PATH=/opt/qb64/qb64pe

# ---------------------------------------------------------------------------
# App build
# ---------------------------------------------------------------------------
WORKDIR /app

# Install nextjs-basic plugin deps
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy the plugin source (in a real project this comes from the npm package)
COPY . .

# Copy example app
WORKDIR /app/example
COPY example/package*.json ./
RUN npm install --legacy-peer-deps

COPY example/ .

# Build Next.js (this triggers the BasicPlugin which compiles .bas -> binaries)
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime image
# ---------------------------------------------------------------------------
FROM ubuntu:22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    libgl1-mesa-glx \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built app and compiled binaries from the build stage
COPY --from=base /app/example/.next ./.next
COPY --from=base /app/example/node_modules ./node_modules
COPY --from=base /app/example/package.json ./package.json
COPY --from=base /app/example/bin ./bin
COPY --from=base /app/example/public ./public 2>/dev/null || true

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node_modules/.bin/next", "start"]
