# MT909 / H02 TCP

## Protocol (Traccar VPS confirmed)
- Real device: H02 binary marker 0x24 ($); also *HQ ASCII
- Port 5013 H02; device_id 7026238813
- Smoke lat~32.04726 lon~118.74223 course~139
- Logs rawHex 16-32B on parse success/fail
- * ASCII + Mictrack fallback; ACK *HQ,id,R12,HHmmss#
- speed km/h = BCD raw * 1.852 (Traccar knots)
