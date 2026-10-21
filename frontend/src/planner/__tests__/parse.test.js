import { describe, expect, test } from "vitest";
import { parseNumber, parseRequest } from "../parse";

const TODAY = "2026-10-21";

describe("parseRequest", () => {
  test("English request with price, weight, volume and a month name", () => {
    const { request, missing } = parseRequest(
      "Client: Medjerda Olive Oil Co.\nWe need to ship 18.4 t of bottled olive oil (100 m3) from Port of Rades to Rotterdam, delivery before 14 Nov. Budget $7,800.",
      TODAY,
    );
    expect(missing).toEqual([]);
    expect(request).toMatchObject({
      client: "Medjerda Olive Oil Co",
      origin: "Rades",
      destination: "Rotterdam",
      weight_kg: 18400,
      volume_m3: 100,
      deadline: "2026-11-14",
      price: { amount: 7800, currency: "USD" },
      containers: [],
    });
  });

  test("French request with boxes, 'à destination de' and euros", () => {
    const { request } = parseRequest(
      "Bonjour, client : Sotupresse. Expédition de 2 x 40HC de Sfax à destination de Gênes, marchandise : papier, livraison avant le 5 décembre. Prix proposé 3 900 €.",
      TODAY,
    );
    expect(request).toMatchObject({
      client: "Sotupresse",
      origin: "Sfax",
      destination: "Genoa",
      commodity: "papier",
      deadline: "2026-12-05",
      price: { amount: 3900, currency: "EUR" },
      containers: [{ code: "40HC", count: 2 }],
    });
  });

  test("Arabic request with reefer cargo and Arabic-Indic digits", () => {
    const { request } = parseRequest("العميل: شركة الجنوب\nشحن ١٢ طن من التمور المبردة من رادس إلى مرسيليا قبل 10 نوفمبر، الميزانية 2500 دولار", TODAY);
    expect(request).toMatchObject({
      client: "شركة الجنوب",
      origin: "Rades",
      destination: "Marseille Fos",
      weight_kg: 12000,
      reefer: true,
      deadline: "2026-11-10",
      price: { amount: 2500, currency: "USD" },
    });
  });

  test("destination named first is still read as the destination", () => {
    const { request } = parseRequest("Deliver to Hamburg, 30 m3 loading at Rades", TODAY);
    expect(request).toMatchObject({ origin: "Rades", destination: "Hamburg", volume_m3: 30 });
  });

  test("pallet sizes are not read as containers; hazmat and dd/mm/yyyy are", () => {
    const { request } = parseRequest("3x20' reefer Shanghai -> Rades, UN1263 paint, 120x40 cm pallets, by 21/11/2026", TODAY);
    expect(request.containers).toEqual([{ code: "20RF", count: 3 }]);
    expect(request.hazmat).toBe(true);
    expect(request.deadline).toBe("2026-11-21");
  });

  test("reports what is missing", () => {
    expect(parseRequest("Need a quote to Rotterdam please", TODAY).missing).toEqual(["origin", "quantity"]);
  });
});

test("parseNumber reads thousands and decimal separators", () => {
  expect(parseNumber("7,800")).toBe(7800);
  expect(parseNumber("7 800")).toBe(7800);
  expect(parseNumber("7.800")).toBe(7800);
  expect(parseNumber("18.4")).toBe(18.4);
  expect(parseNumber("18,4")).toBe(18.4);
  expect(parseNumber("1.234,5")).toBe(1234.5);
});
