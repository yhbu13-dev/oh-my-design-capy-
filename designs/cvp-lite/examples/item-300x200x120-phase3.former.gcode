; CVP-Lite former recipe  base 314 x 214  wall 125 mm
; axes: X end-paddle screw, Y side-beam screws, Z press head, A belt, B fence, C press head X
G21 G90 G94
G0 Z347.6
G0 X157.0 Y107.0 B-232.0 C-720.0
; host waits for the infeed sensor, then zeroes the belt
G92 A0
G1 A71.2 F30000
M62 P6
M62 P7
G1 A133.8 F30000
M63 P6
M63 P7
G1 A511.2 F30000
M62 P6
M62 P7
G1 A575.8 F30000
M63 P6
M63 P7
G1 A944.0 F30000
M62 P8
G1 A968.0 F30000
M63 P8
G1 A1182.0 F30000
; operator places the item on the base, light curtain clears, cycle start
M0
; 1 walls up: sides first so the ears stand clear of them
M64 P0
G4 P0.5
M64 P1
M64 P2
G4 P0.5
; 2 ear plates sweep in from both ends and stay as clamps
M64 P3
M64 P4
G4 P0.9
; 3 drop side and front paddles; back paddle keeps the lid standing
M65 P0
M65 P1
G4 P0.3
; 4 plow the lid over towards +X with the head's leading edge
G1 C7.0 F48000
M65 P2
G4 P0.3
; 5 press the lid flat, wipe the tuck down onto the front wall, hold for the glue
G1 Z133.0 F18000
M64 P5
G4 P1.5
M65 P5
G4 P0.3
; 6 release and send the box out under the raised head
G0 Z165.0
M65 P3
M65 P4
G4 P0.8
G91 G1 A1000 F30000
G90
G0 Z347.6
G0 C-720.0
M2
