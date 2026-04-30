Create a complete 8-direction × 6-frame pixel-art running animation sprite sheet for a top-down isometric RPG/fighting-game style character.

Canvas and layout:
- Limegreen background, easy to remove.
- 8 rows × 6 columns = 48 total sprites.
- Each row is one direction. Each column is one animation frame (frame 1 through frame 6, left to right).
- Even spacing between all sprites.
- Same scale and framing for every sprite across all rows and columns.
- No text, no labels, no props, no background.
- Character should fit cleanly inside each cell with consistent padding.

Row order (top to bottom):
Row 1: South / front-facing
Row 2: South-east / front-right 3/4 view
Row 3: East / right-facing side view, but still slightly top-down
Row 4: North-east / back-right 3/4 view
Row 5: North / back-facing
Row 6: North-west / back-left 3/4 view
Row 7: West / left-facing side view, but still slightly top-down
Row 8: South-west / front-left 3/4 view

Frame order (left to right, columns 1–6) — a smooth 6-frame run cycle:
Frame 1: Right foot strike — right foot contacts ground forward, left arm swings forward, left leg trailing back.
Frame 2: Right foot midstance — weight over right foot, body dips slightly, left leg lifting.
Frame 3: Push-off — right foot pushing off the ground behind, left foot swinging forward, body leans forward.
Frame 4: Left foot strike — left foot contacts ground forward, right arm swings forward, right leg trailing back.
Frame 5: Left foot midstance — weight over left foot, body dips slightly, right leg lifting.
Frame 6: Push-off (mirror) — left foot pushing off behind, right foot swinging forward, body leans forward.

The 6 frames must loop seamlessly: frame 6 transitions cleanly back into frame 1.

Perspective:
Use the same high isometric top-down POV for all 48 sprites. The camera is above the character looking downward at an angle, like a 90s isometric CRPG or tactical RPG. Do not make the east and west views flat side-profile drawings; they should still show the top of the head, shoulders, chest/back plane, and feet from above. Running momentum and lean must read clearly from the top-down angle.

Character:
Adult muscular athletic female fighter character with tan skin, defined shoulders, arms, abs, thighs, and calves. Dark brown/black hair tied in a high ponytail or bun with a few loose strands — ponytail should swing with the run cycle. Serious focused expression. Wearing a black sports-bra-style top and black athletic briefs. Barefoot. No weapons, no accessories.

Animation requirements:
- Hair ponytail should visibly trail opposite to the direction of motion, swinging slightly with each stride.
- Arms swing in opposition to legs (right arm forward when left leg is forward).
- Upper body leans forward slightly in the direction of travel.
- Feet clearly leave the ground during the float phase (frames 3 and 6).
- Body height bobs slightly — lowest at midstance frames (2 and 5), highest at push-off frames (3 and 6).
- All motion must remain readable from the isometric top-down angle.

Pixel-art style:
- Crisp retro pixel art.
- 90s isometric RPG / arcade fighter influence.
- Hand-painted pixel shading.
- Strong dark outline.
- Limited palette, approximately 16–32 colors.
- Dithered highlights and shadows.
- High contrast anatomy, fabric, and hair shading.
- No anti-aliased painterly blur.
- No 3D render look.
- No smooth vector art.
- No modern cartoon style.

Consistency requirements:
The character must look like the same person across all 48 sprites.
Maintain consistent body proportions, head size, hair volume, outfit shape, skin tone, lighting direction, sprite height, pixel density, and outline thickness across all rows and columns.
Each row must be visually consistent with the neutral idle sprites from the companion idle sprite sheet.

Lighting:
Single consistent light source from the upper-left/north-west.
Subtle highlights on upper-left planes.
Softer shadows on lower-right planes.
Lighting direction does not change between frames or rows.

Output:
One unified sprite sheet image with all 48 sprites arranged in 8 rows × 6 columns, ready for game development use. The background should be lime green for easy removal in game engines. Each sprite should be perfectly aligned within its cell for seamless animation playback and directional switching.
