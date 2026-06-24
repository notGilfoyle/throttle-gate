# Demo "your service" for the sidecar bundle: the FastAPI example app protected
# by the Throttle-Gate middleware adapter. Build context is the repo root.
FROM python:3.12-slim

WORKDIR /srv
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" httpx

# The adapter module + the example service that uses it.
COPY adapters/fastapi/throttle_gate.py adapters/fastapi/example_app.py ./

EXPOSE 9000
CMD ["uvicorn", "example_app:app", "--host", "0.0.0.0", "--port", "9000"]
