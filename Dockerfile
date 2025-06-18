# Use an official Python base image.
# Your venv path previously indicated python3.12. Using 3.12-slim for a smaller image.
FROM python:3.12-slim

# Set environment variables for non-interactive apt-get and Python
ENV PYTHONUNBUFFERED 1
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG C.UTF-8
ENV LC_ALL C.UTF-8
# Ensures pip installs packages to a path that's generally available
# and doesn't complain about running as root (common in Docker)
ENV PIP_USER=0 
ENV PIP_ROOT_USER_ACTION=ignore

# Install system dependencies required for building hypersync and its Rust dependencies
# - capnproto: For compiling Cap'n Proto schemas (hypersync-net-types dependency)
# - patchelf: To resolve warnings during maturin build and set rpath
# - curl: To install Rust via rustup
# - build-essential: Common C/C++ build tools (gcc, g++, make)
# - pkg-config, libssl-dev: Common for Rust networking/crypto crates
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    capnproto \
    patchelf \
    curl \
    build-essential \
    pkg-config \
    libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Install Rust using rustup (official method)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
# Add Rust's cargo bin directory to PATH for the root user (default user in python:slim)
ENV PATH="/root/.cargo/bin:${PATH}"

# Set the working directory in the container
WORKDIR /app

# Set CARGO_HOME to a writable directory within the image (inside /app)
# This ensures Cargo uses this path for its caches and Git dependency checkouts.
ENV CARGO_HOME=/app/.cargo_cache 
RUN mkdir -p $CARGO_HOME

# --- Files needed to build the hypersync package ---
# Copy pyproject.toml first, as it defines the build system (maturin)
COPY pyproject.toml ./
# Copy Cargo.toml and Cargo.lock for Rust dependencies
COPY Cargo.toml ./
COPY Cargo.lock ./
# If you use poetry.lock or poetry.toml and they are essential for the hypersync build, copy them.
# COPY poetry.lock ./
# COPY poetry.toml ./ 
COPY README.md ./ 
COPY LICENSE ./ 

# Copy the Rust source code (typically in an 'src' directory at the project root)
COPY src/ ./src/
# Copy the Python part of the hypersync package (typically in a 'hypersync' directory)
# This directory must contain the comprehensive __init__.py file that correctly exports names.
COPY hypersync/ ./hypersync/

# --- Application specific files ---
# Copy your application's requirements file (for FastAPI, Uvicorn, etc.)
COPY requirements.txt ./

# Ensure pip is up-to-date, then build and install your local `hypersync` package
# This will compile the Rust components. `capnp` and `patchelf` should now be found.
# The `CARGO_HOME` environment variable will be respected by cargo/maturin.
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# Install other Python dependencies for your FastAPI application
RUN pip install --no-cache-dir -r requirements.txt

# Copy your main FastAPI application file
# ***** ENSURING THIS MATCHES THE ERROR LOG *****
COPY main_web_optimized.py ./ 

# The 'static' folder is for your Vercel frontend, so it's NOT copied into this backend Docker image.
# The .env file should NOT be copied; set environment variables in Render's UI.

# Render provides the PORT environment variable. Uvicorn will listen on this port.
# EXPOSE is good practice to document the port.
EXPOSE 8000 

# --- Default command to run the application ---
# This command will be executed when the container starts.
# Render provides the PORT environment variable dynamically.
# Using 0.0.0.0 to bind to all interfaces for Docker deployment.
CMD sh -c 'uvicorn main_web_optimized:app --host 0.0.0.0 --port "${PORT:-8000}"'
