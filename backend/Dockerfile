FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# El entrypoint aplica las migraciones, fija PORT si el entorno no lo trae, y
# luego cede el paso al CMD.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]

# Sin --reload: eso es una comodidad de desarrollo y el compose la agrega.
# Dejarla en la imagen significaria enviar a produccion un servidor que se
# reinicia solo cuando cambia un archivo.
#
# Se usa la forma "shell" para que $PORT se expanda: con la forma de lista, el
# CMD no pasa por un shell y el valor llegaria literalmente como "$PORT".
CMD uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
