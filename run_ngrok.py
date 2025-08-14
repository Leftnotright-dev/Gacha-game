from pyngrok import ngrok, conf
import subprocess
import time

# OPTIONAL: set your ngrok auth token here so you don't have to run ngrok CLI
conf.get_default().auth_token = "30ugIzwbQwKpZeYtdsrWRxNLGn9_4Yem1qW3XmXSVJNyDro1K"

# Start Flask server
flask_process = subprocess.Popen(["python", "app.py"])

# Give Flask time to start
time.sleep(2)

# Open ngrok tunnel on port 5000
public_url = ngrok.connect(5000, "http").public_url
print(f"Your public URL is: {public_url}")
print("Press CTRL+C to stop both Flask and ngrok.")

try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\nShutting down...")
    flask_process.terminate()
    ngrok.kill()
