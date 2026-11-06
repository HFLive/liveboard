FROM postgres:16-alpine AS builder

# Keep the existing Alpine PostgreSQL 16 data format and locale environment.
# Build a fixed, verified pgvector release; the final image needs no compiler.
RUN apk add --no-cache build-base curl \
    && curl --fail --location --retry 3 \
      https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v0.8.1 \
      --output /tmp/pgvector.tar.gz \
    && echo "a9094dfb85ccdde3cbb295f1086d4c71a20db1d26bf1d6c39f07a7d164033eb4  /tmp/pgvector.tar.gz" | sha256sum -c - \
    && mkdir /tmp/pgvector \
    && tar -xzf /tmp/pgvector.tar.gz -C /tmp/pgvector --strip-components=1 \
    && make -C /tmp/pgvector OPTFLAGS="" with_llvm=no \
    && make -C /tmp/pgvector with_llvm=no DESTDIR=/tmp/install install

FROM postgres:16-alpine
COPY --from=builder /tmp/install/usr/local/ /usr/local/
