# Image for the example app: QB64-PE compiles the BASIC routes, Next.js serves them.
#
# Build from the repository root, because the example installs the plugin from the
# folder above it:
#
#   docker build -f example/Dockerfile -t nextjs-basic-example .
#   docker run -p 3000:3000 nextjs-basic-example
#
# Build arg:
#   QB64PE_VERSION  QB64-PE release tag (default v4.7.0-GLFW)
#
# CI builds this image and calls every example route on each push.
#
# In your own project the plugin comes from `npm install github:EthanThatOneKid/nextjs-basic`
# instead, so drop the first `npm install` and the COPY of the plugin source.

FROM node:22-bookworm

ARG QB64PE_VERSION=v4.7.0-GLFW

# QB64-PE turns BASIC into C++ and compiles it, so it needs a C++ toolchain and these
# libraries. The compiled routes link against some of them too, which is why this is
# one image and not a build stage plus a slim runtime stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl x11-utils mesa-common-dev libglu1-mesa-dev \
      libasound2-dev libpng-dev libcurl4-openssl-dev libx11-dev libxcursor-dev \
      libxrandr-dev libxinerama-dev libxi-dev \
    && rm -rf /var/lib/apt/lists/*

# QB64-PE ships as source on Linux: download it and build the compiler once. The
# warm-up compile builds QB64's own support libraries now instead of on the first
# route build.
RUN curl -fsSL "https://github.com/QB64-Phoenix-Edition/QB64pe/releases/download/${QB64PE_VERSION}/qb64pe_lnx-x64-${QB64PE_VERSION#v}.tar.gz" \
      | tar -xz -C /opt \
    && cd /opt/qb64pe \
    && make OS=lnx BITS=64 BUILD_QB64=y -j2 \
    && printf '$CONSOLE:ONLY\nPRINT "ok"\nSYSTEM\n' > /tmp/warm.bas \
    && ./qb64pe -x /tmp/warm.bas -o /tmp/warm \
    && /tmp/warm \
    && rm /tmp/warm /tmp/warm.bas

ENV QB64_PATH=/opt/qb64pe/qb64pe

WORKDIR /app
COPY . .

# The plugin at the repository root. npm runs its "prepare" script, which builds dist/.
RUN npm install --legacy-peer-deps

# The example app. `next build` runs the plugin, which compiles each route.bas into bin/.
WORKDIR /app/example
RUN npm install --legacy-peer-deps && npm run build

ENV NODE_ENV=production
EXPOSE 3000

# PORT is set by Railway and Render; 3000 otherwise
CMD ["sh", "-c", "exec npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
