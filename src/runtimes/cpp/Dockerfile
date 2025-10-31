FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends g++ gcc libc6-dev && rm -rf /var/lib/apt/lists/*
RUN useradd -m runner
RUN mkdir -p /work && chown runner:runner /work
WORKDIR /work
USER runner
