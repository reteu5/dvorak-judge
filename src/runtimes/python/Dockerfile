FROM python:3.12-slim
RUN useradd -m runner
RUN mkdir -p /work && chown runner:runner /work
WORKDIR /work
USER runner
