import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as soap from 'soap';
import { downloadAll, extractRefs, sanitizeName } from '../scripts/download-wsdl';

function wsdlXml(port: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:tns="http://citizen.xyp.gov.mn/"
    targetNamespace="http://citizen.xyp.gov.mn/">
  <wsdl:types>
    <xsd:schema targetNamespace="http://citizen.xyp.gov.mn/"
        xmlns:ext="http://citizen.xyp.gov.mn/ext">
      <xsd:import namespace="http://citizen.xyp.gov.mn/ext"
          schemaLocation="http://127.0.0.1:${port}/types.xsd"/>
      <xsd:element name="WS100101_getCitizenIDCardInfo">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="regnum" type="xsd:string"/>
        </xsd:sequence></xsd:complexType>
      </xsd:element>
      <xsd:element name="WS100101_getCitizenIDCardInfoResponse">
        <xsd:complexType><xsd:sequence>
          <xsd:element name="return" type="xsd:string"/>
        </xsd:sequence></xsd:complexType>
      </xsd:element>
    </xsd:schema>
  </wsdl:types>
  <wsdl:message name="reqMsg"><wsdl:part name="parameters" element="tns:WS100101_getCitizenIDCardInfo"/></wsdl:message>
  <wsdl:message name="resMsg"><wsdl:part name="parameters" element="tns:WS100101_getCitizenIDCardInfoResponse"/></wsdl:message>
  <wsdl:portType name="XypPort">
    <wsdl:operation name="WS100101_getCitizenIDCardInfo">
      <wsdl:input message="tns:reqMsg"/>
      <wsdl:output message="tns:resMsg"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="XypBinding" type="tns:XypPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="WS100101_getCitizenIDCardInfo">
      <soap:operation soapAction="WS100101_getCitizenIDCardInfo"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
      <wsdl:output><soap:body use="literal"/></wsdl:output>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="XypService">
    <wsdl:port name="XypPort" binding="tns:XypBinding">
      <soap:address location="http://127.0.0.1:${port}/ws"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
}

const typesXsd = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    targetNamespace="http://citizen.xyp.gov.mn/ext">
  <xsd:element name="meta" type="xsd:string"/>
</xsd:schema>`;

let server: http.Server;
let port: number;
let tmpDir: string;

before(async () => {
  server = http.createServer((req, res) => {
    if ((req.url || '').startsWith('/types.xsd')) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(typesXsd);
    } else if ((req.url || '').startsWith('/ws')) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(wsdlXml(port));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as import('net').AddressInfo).port;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xyp-wsdl-'));
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractRefs нь schemaLocation-ийг олж, soap:address-ийг алгасна', () => {
  const refs = extractRefs(wsdlXml(port));
  assert.ok(refs.some((r) => r.endsWith('/types.xsd')));
  assert.ok(!refs.some((r) => r.endsWith('/ws')));
});

test('downloadAll нь WSDL + импортлосон XSD-г татаж, лавлагааг локал болгоно', async () => {
  const startUrl = `http://127.0.0.1:${port}/ws?WSDL`;
  const { rootName, files } = await downloadAll({ startUrl, outDir: tmpDir, name: 'service.wsdl' });

  assert.strictEqual(rootName, 'service.wsdl');
  assert.ok(files.includes('service.wsdl'));
  assert.ok(files.includes('types.xsd'));

  const wsdlText = fs.readFileSync(path.join(tmpDir, 'service.wsdl'), 'utf8');
  assert.match(wsdlText, /schemaLocation="types\.xsd"/);
  assert.ok(!/schemaLocation="http/.test(wsdlText));
  assert.match(wsdlText, /soap:address location="http:\/\/127\.0\.0\.1/);
});

test('татсан локал WSDL-ээс node-soap клиент үүсч, операц олдоно', async () => {
  const localWsdl = path.join(tmpDir, 'service.wsdl');
  const client = await soap.createClientAsync(localWsdl);
  const desc = client.describe() as Record<string, Record<string, Record<string, unknown>>>;

  const ops = new Set<string>();
  for (const svc of Object.values(desc))
    for (const p of Object.values(svc)) for (const op of Object.keys(p)) ops.add(op);

  assert.ok(ops.has('WS100101_getCitizenIDCardInfo'));
  assert.strictEqual(
    typeof (client as unknown as Record<string, unknown>).WS100101_getCitizenIDCardInfoAsync,
    'function'
  );
});

test('sanitizeName нь ?WSDL query-г зохистой нэр болгоно', () => {
  assert.match(sanitizeName('https://xyp.gov.mn/citizen-1.5.0/ws?WSDL', 'x.wsdl'), /\.wsdl$/);
});
