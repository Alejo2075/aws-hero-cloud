from flask import Flask

app = Flask(__name__)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/")
def index():
    return "hello from flask"
