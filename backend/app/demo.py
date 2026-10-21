"""Example offer and matrix used until the agent and live data gateways are wired in."""

from .agent.schemas import BestFormulaMatrix

DEMO_OFFER = {
    "id": "demo-rades-rotterdam",
    "client_name": "Medjerda Olive Oil Co.",
    "origin_port": "Port of Rades, TN",
    "destination_port": "Port of Rotterdam, NL",
    "cargo_details": {
        "weight_kg": 18400,
        "volume_m3": 100,
        "commodity": "Bottled olive oil, palletised",
        "hazmat": False,
    },
    "deadline": "2026-11-14T17:00:00Z",
    "status": "optimized",
}

DEMO_MATRIX = BestFormulaMatrix.model_validate(
    {
        "offer_id": DEMO_OFFER["id"],
        "options": [
            {
                "id": "A",
                "strategy": "lowest_cost",
                "summary": "MSC via Gioia Tauro transshipment on leased boxes from Container xChange.",
                "transit_days": 14,
                "profit_margin": {
                    "currency": "USD",
                    "client_revenue": "7800",
                    "carrier_freight_cost": "3900",
                    "container_rent_fee": "520",
                    "port_fees": "610",
                },
                "equipment": {
                    "containers": [
                        {"count": 2, "size": "40ft", "type": "High Cube Dry Van", "provider": "Container-xChange", "leased": True}
                    ],
                    "carriers": ["MSC"],
                    "utilization_pct": "65.4",
                },
                "risk": {
                    "origin_free_days": 4,
                    "destination_free_days": 3,
                    "detention_fee_per_day": "65",
                    "demurrage_fee_per_day": "85",
                    "deadline_risk": "medium",
                    "pitfalls": [
                        "Transshipment at Gioia Tauro adds 2 to 4 days of roll-over risk.",
                        "Leased boxes are 12+ years old; inspect for CSC plate validity before stuffing.",
                        "Only 3 free days at Rotterdam; book the haulier before arrival.",
                    ],
                },
            },
            {
                "id": "B",
                "strategy": "fastest_transit",
                "summary": "Maersk direct weekly service on carrier-owned equipment.",
                "transit_days": 7,
                "profit_margin": {
                    "currency": "USD",
                    "client_revenue": "7800",
                    "carrier_freight_cost": "5450",
                    "container_rent_fee": "0",
                    "port_fees": "640",
                },
                "equipment": {
                    "containers": [
                        {"count": 2, "size": "40ft", "type": "High Cube Dry Van", "provider": "Maersk", "leased": False}
                    ],
                    "carriers": ["Maersk"],
                    "utilization_pct": "65.4",
                },
                "risk": {
                    "origin_free_days": 7,
                    "destination_free_days": 5,
                    "detention_fee_per_day": "90",
                    "demurrage_fee_per_day": "110",
                    "deadline_risk": "low",
                    "pitfalls": [
                        "Highest freight cost; margin falls below 25% if the rate rises 10%.",
                        "Peak season surcharge may apply on November sailings.",
                    ],
                },
            },
            {
                "id": "C",
                "strategy": "balanced",
                "summary": "Split: 40ft HC on CMA CGM plus a leased 20ft on MSC, sized to the cargo.",
                "transit_days": 10,
                "profit_margin": {
                    "currency": "USD",
                    "client_revenue": "7800",
                    "carrier_freight_cost": "4300",
                    "container_rent_fee": "380",
                    "port_fees": "690",
                },
                "equipment": {
                    "containers": [
                        {"count": 1, "size": "40ft", "type": "High Cube Dry Van", "provider": "CMA CGM", "leased": False},
                        {"count": 1, "size": "20ft", "type": "Dry Van", "provider": "Container-xChange", "leased": True},
                    ],
                    "carriers": ["CMA CGM", "MSC"],
                    "utilization_pct": "91.2",
                },
                "risk": {
                    "origin_free_days": 5,
                    "destination_free_days": 4,
                    "detention_fee_per_day": "70",
                    "demurrage_fee_per_day": "95",
                    "deadline_risk": "low",
                    "pitfalls": [
                        "Two bills of lading; both boxes must clear customs before delivery.",
                        "If one carrier rolls the booking, the shipment arrives split.",
                    ],
                },
            },
        ],
        "recommended": "C",
        "recommendation_reason": "Keeps a 31% margin on a 10-day transit with low deadline risk, and fills the boxes to 91%.",
    }
)
