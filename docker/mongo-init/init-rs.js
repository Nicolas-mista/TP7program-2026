// Inicia el replica set rs0 de un solo nodo y espera a que sea PRIMARY.
// Se ejecuta con: mongosh --host mongo:27017 --file /init-rs.js
print("Configurando replica set rs0...");

try {
  const estado = rs.status();
  print("Replica set ya iniciado: " + estado.set + " (myState=" + estado.myState + ")");
} catch (e) {
  print("Iniciando replica set rs0 (host mongo:27017)...");
  rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "mongo:27017" }],
  });
}

let listo = false;
for (let i = 0; i < 90; i += 1) {
  try {
    const hello = db.hello();
    if (hello.isWritablePrimary) {
      listo = true;
      break;
    }
  } catch (e) {
    // todavia eligiendo primario
  }
  sleep(1000);
}

if (!listo) {
  print("ERROR: el replica set no llego a PRIMARY");
  quit(1);
}

print("MongoDB PRIMARY listo en rs0");
