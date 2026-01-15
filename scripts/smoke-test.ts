import { createHmac } from "node:crypto";

const authKey =
  process.env.TRANSLOADIT_AUTH_KEY ?? process.env.TRANSLOADIT_KEY ?? "";
const authSecret =
  process.env.TRANSLOADIT_AUTH_SECRET ?? process.env.TRANSLOADIT_SECRET ?? "";

if (!authKey || !authSecret) {
  throw new Error(
    "Missing TRANSLOADIT_AUTH_KEY/TRANSLOADIT_KEY or TRANSLOADIT_AUTH_SECRET/TRANSLOADIT_SECRET",
  );
}

const params = {
  auth: {
    key: authKey,
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  },
  steps: {
    ":original": {
      robot: "/upload/handle",
    },
  },
};

const paramsString = JSON.stringify(params);
const signature = createHmac("sha384", authSecret)
  .update(paramsString)
  .digest("hex");

const formData = new FormData();
formData.append("params", paramsString);
formData.append("signature", `sha384:${signature}`);

const response = await fetch("https://api2.transloadit.com/assemblies", {
  method: "POST",
  body: formData,
});

const data = await response.json();

if (!response.ok) {
  throw new Error(
    `Transloadit error ${response.status}: ${JSON.stringify(data)}`,
  );
}

const assemblyId = data.assembly_id ?? data.assemblyId;

if (!assemblyId) {
  throw new Error("Transloadit response missing assembly_id");
}

console.log(
  JSON.stringify(
    {
      assemblyId,
      ok: data.ok,
      message: data.message,
      tusUrl: data.tus_url ?? data.tusUrl,
    },
    null,
    2,
  ),
);
