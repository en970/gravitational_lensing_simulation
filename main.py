import pygame
import numpy as np
import sys
pygame.init()

WIDTH = 800
HEIGHT = 600
PADDING = 400
BG_WIDTH = WIDTH + PADDING * 2
BG_HEIGHT = HEIGHT + PADDING * 2

screen= pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Gravitational Lensing")
clock= pygame.time.Clock()
lens_mass= 5.0


def create_background_texture():
    #the stars and galaxies in the background
    
    background = np.zeros((BG_HEIGHT, BG_WIDTH), dtype=np.float32)
    
    #set a random seed
    np.random.seed(42)
    
    for i in range(2000):
        x = np.random.randint(0, BG_WIDTH)
        y = np.random.randint(0, BG_HEIGHT)
        brightness = np.random.randint(60, 255)
        size = np.random.choice([1, 1, 1, 1, 2, 2, 3])
        
        for dy in range(-size, size + 1):
            for dx in range(-size, size + 1):
                if 0 <= x + dx < BG_WIDTH and 0 <= y + dy < BG_HEIGHT:
                    dist = np.sqrt(dx*dx + dy*dy)
                    if dist <= size:
                        b = brightness * (1 - dist / (size + 1))
                        background[y + dy, x + dx] = max(background[y + dy, x + dx], b)
    
    #the main galaxy at the center
    add_galaxy(background, BG_WIDTH // 2, BG_HEIGHT // 2, 110, 255)
    
    #adding some smaller galaxies around
    add_galaxy(background, PADDING + 80, PADDING + 80,45,200)
    add_galaxy(background, PADDING + 720, PADDING + 80,40,180)
    add_galaxy(background, PADDING + 80, PADDING + 520,50,190)
    add_galaxy(background, PADDING + 720, PADDING + 520,45,185)
    add_galaxy(background, PADDING + 400, PADDING + 120,35,170)
    add_galaxy(background, PADDING + 200, PADDING + 300,30,160)
    add_galaxy(background, PADDING + 600, PADDING + 350,35,175)
    add_galaxy(background, 120, BG_HEIGHT // 2,65,220)
    add_galaxy(background, BG_WIDTH - 120, BG_HEIGHT // 2,60,215)
    add_galaxy(background, BG_WIDTH // 2, 120,55,210)
    add_galaxy(background, BG_WIDTH // 2, BG_HEIGHT - 120,60,215)
    
    #groups of stars close together
    add_star_cluster(background, PADDING + 150, PADDING + 200,40,50)
    add_star_cluster(background, PADDING + 650, PADDING + 400,35,45)
    add_star_cluster(background, PADDING + 300, PADDING + 450,45,55)
    
    #nebulae
    add_nebula(background, PADDING + 500, PADDING + 200,70)
    add_nebula(background, PADDING + 100, PADDING + 400,60)
    add_nebula(background, 200, 300,90)
    add_nebula(background, BG_WIDTH - 200, BG_HEIGHT - 300,80)
    
    #galaxy clusters
    add_galaxy_cluster(background, PADDING + 350, PADDING + 550,80)
    add_galaxy_cluster(background, PADDING + 650, PADDING + 150,70)
    return np.clip(background, 0, 255).astype(np.uint8)


def add_galaxy(background, cx, cy, radius, max_brightness):
    #make a spiral galaxy
    #cx, cy is the center
    #radius is how big it is
    #max_brightness is how bright the center is
    
    margin = radius * 2 + 10
    y_min = max(0, cy - margin)
    y_max = min(BG_HEIGHT, cy + margin)
    x_min = max(0, cx - margin)
    x_max = min(BG_WIDTH, cx + margin)
    
    
    if y_max <= y_min or x_max <= x_min:
        return
    
    y, x = np.ogrid[y_min:y_max, x_min:x_max]
    dist = np.sqrt((x - cx)**2 + (y - cy)**2) + 0.1
    
    brightness = max_brightness * np.exp(-dist / (radius * 0.4))

    angle = np.arctan2(y - cy, x - cx)

    spiral = 0.5 + 0.5 * np.sin(angle * 2 + dist * 0.1)

    brightness = brightness * spiral

    core = max_brightness * np.exp(-dist / (radius * 0.12))

    brightness = np.maximum(brightness, core)
    
    background[y_min:y_max, x_min:x_max] = np.maximum(
        background[y_min:y_max, x_min:x_max], brightness)


def add_star_cluster(background, cx, cy, radius, num_stars):
    
    for i in range(num_stars):
        angle = np.random.random() *2 *np.pi
        r = np.random.random() **0.5 * radius
        x = int(cx + r*np.cos(angle))
        y = int(cy + r*np.sin(angle))
        
        if 0 <= x < BG_WIDTH and 0 <= y < BG_HEIGHT:
            brightness = np.random.randint(150, 255)
            background[y, x] = max(background[y, x], brightness)
            #bigger stars
            if np.random.random() > 0.7:
                for dy in [-1, 0, 1]:
                    for dx in [-1, 0, 1]:
                        if 0 <= x+dx < BG_WIDTH and 0 <= y+dy < BG_HEIGHT:
                            background[y+dy, x+dx] = max(background[y+dy, x+dx], brightness * 0.7)


def add_nebula(background, cx, cy, radius):
    
    y_min = max(0, cy - radius)
    y_max = min(BG_HEIGHT, cy + radius)
    x_min = max(0, cx - radius)
    x_max = min(BG_WIDTH, cx + radius)
    
    if y_max <= y_min or x_max <= x_min:
        return
    
    y, x = np.ogrid[y_min:y_max, x_min:x_max]
    dist = np.sqrt((x - cx)**2 + (y - cy)**2)
    brightness = 35 * np.exp(-dist / (radius *0.5))
    
    noise = np.random.rand(y_max - y_min, x_max - x_min) * 25
    brightness = brightness + noise * np.maximum(0, 1 - dist / radius)
    
    background[y_min:y_max, x_min:x_max] = np.maximum(
        background[y_min:y_max,x_min:x_max], brightness)


def add_galaxy_cluster(background, cx, cy, radius):
    
    num = np.random.randint(8, 15)
    for i in range(num):
        angle = np.random.random() *2 *np.pi
        r = np.random.random() * radius
        gx = int(cx + r*np.cos(angle))
        gy = int(cy + r*np.sin(angle))
        gr = np.random.randint(8, 20)
        gb = np.random.randint(60, 120)
        add_galaxy(background, gx, gy, gr, gb)


#background image
background_texture = create_background_texture()


def render_lensed_view(lens_x, lens_y, mass):
    #calculates how light gets bent around the black hole
    
    #beta = theta - theta_E^2 / theta
    #Where:
    #beta is where the light actually comes from
    #theta is where we see it on screen
    #theta_E is the Einstein radius (depends on mass)
    
    #make a grid of all pixel positions
    y_img, x_img = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    
    #calculate distance from each pixel to the black hole
    dx = x_img - lens_x
    dy = y_img - lens_y
    theta = np.sqrt(dx**2 + dy**2)
    theta = np.maximum(theta, 0.1)  #dividing by zero case
    
    #einstein radius
    theta_E = mass * 20.0
    #the event horizon
    r_schwarzschild = mass*3.0
    
    deflection = (theta_E**2) / theta
    beta_magnitude = theta - deflection
    
    #direction vector
    unit_x = dx / theta
    unit_y = dy / theta
    
    #calculate source position
    source_x = lens_x + beta_magnitude * unit_x + PADDING
    source_y = lens_y + beta_magnitude * unit_y + PADDING
    
    #don't go outside the background
    source_xi = np.clip(source_x.astype(np.int32), 0, BG_WIDTH - 1)
    source_yi = np.clip(source_y.astype(np.int32), 0, BG_HEIGHT - 1)
    output = background_texture[source_yi, source_xi].copy().astype(np.float32)
    
    #magnification effect
    with np.errstate(divide='ignore', invalid='ignore'):
        magnification = np.abs(theta / (beta_magnitude + 0.1))
        magnification = np.clip(magnification, 0.5, 4.0)
    
    output = output * magnification
    
    #event horizon is black
    event_horizon = theta < r_schwarzschild
    output[event_horizon] = 0
    output[photon_sphere] *= 0.3
    output = np.clip(output, 0, 255).astype(np.uint8)
    
    #grayscale
    rgb = np.stack([output, output, output], axis=-1)
    
    return pygame.surfarray.make_surface(rgb.swapaxes(0, 1)), r_schwarzschild


def draw_ui(mass):
    font = pygame.font.Font(None, 22)
    
    texts = [
        ("Mouse: Move | Scroll: Mass", (120, 120, 120)),
        ("Mass: " + str(round(mass, 1)), (200, 200, 200)),
    ]
    y = 8
    for text, color in texts:
        surf = font.render(text, True, color)
        screen.blit(surf, (8, y))
        y = y + 16


def main():
    global lens_mass
    running = True
    
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    running = False
            elif event.type == pygame.MOUSEWHEEL:
                if event.y > 0:
                    lens_mass = min(lens_mass *1.1, 25.0)
                else:
                    lens_mass = max(lens_mass / 1.1,1.0)
        
        lens_x, lens_y = pygame.mouse.get_pos()
        keys = pygame.key.get_pressed()
        if keys[pygame.K_UP]:
            lens_mass = min(lens_mass *1.02, 25.0)
        if keys[pygame.K_DOWN]:
            lens_mass = max(lens_mass / 1.02, 1.0)
        
        lensed_surface, r_s = render_lensed_view(lens_x, lens_y, lens_mass)
        screen.blit(lensed_surface, (0, 0))
        pygame.draw.circle(screen, (255, 255, 255), (lens_x, lens_y), int(r_s), 1)
        
        draw_ui(lens_mass)
        pygame.display.flip()
        clock.tick(60)
    
    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()
