const population = 500

// speed, height, status, shouldDuck, distance to next object, distance to next object afterwards
const inputs = 6
// jump, duck, wait
const outputs = 3
var generation = 0
var training = false
var bestNetworkJson = ""
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(network) {
    var resolved = false
    return new Promise(resolve => {
        var tick = 0
        async function update() {
            if(!network && !training) {
                resolve()
                return
            }
            tick += 1
            this.updatePending = false;
    
            const now = getTimeStamp();
            let deltaTime = this.msPerFrame
            if(network) await sleep(this.msPerFrame - (now - (this.time || now)))
            this.time = now;
    
            this.clearCanvas();
    
            this.runningTime += deltaTime;
            const hasObstacles = this.runningTime > this.config.CLEAR_TIME;
            deltaTime = !this.activated ? 0 : deltaTime;
            this.horizon.update(deltaTime, this.currentSpeed, hasObstacles, false);
            this.distanceMeter.update(deltaTime, Math.ceil(this.distanceRan));
    
            const filteredObstacles = this.horizon.obstacles.filter(obstacle => obstacle.xPos > -10)
            const nearest = filteredObstacles[0]
            const obj0 = !nearest ? 1 : nearest.xPos / this.dimensions.WIDTH
            const obj1 = !filteredObstacles[1] ? 1 : filteredObstacles[1].xPos / this.dimensions.WIDTH
            const shouldDuck = nearest && nearest.typeConfig.type == "PTERODACTYL" && nearest.yPos > 50
            const speed = this.currentSpeed / Runner.normalConfig.MAX_SPEED
            
            const tRexesAlive = this.tRexes.some(tRex => !tRex.dead)
            
            if(!tRexesAlive || tick > 1000000) {
                generation += 1
                const scores = neat.population.map(pop=>pop.score)
                const best = Math.max(...scores)
                const bestIndex = scores.indexOf(best)
                bestNetworkJson = JSON.stringify(neat.population[bestIndex].toJSON())

                console.log(`Generation ${generation}, best: ${best}, tick: ${tick}`)
                console.log(bestNetworkJson)

                neat.evolve() 
                resolve()
                resolved = true
                return
            }
    
            this.tRexes.forEach((tRex, index) => {
                if(tRex.dead) return
                
                const height = tRex.yPos / 100
                const ducking = tRex.status === Trex.status.DUCKING
                const status = ducking ? 2 : tRex.status === Trex.status.JUMPING ? 1 : 0;
    
                const genome = network ? network : neat.population[index]
                const inputs = [speed, height, status, shouldDuck ? 1 : 0, obj0, obj1]
                const result = genome.activate(inputs)
                const action = result.indexOf(Math.max(...result))
                // console.log(inputs)
                var jump = action == 0
                var duck = action == 1
    
                // Jump
                if (jump && !tRex.jumping && !tRex.ducking) {
                    tRex.startJump(this.currentSpeed);
                } else if (tRex.jumping && !jump) {
                    tRex.endJump()
                }
    
                // Duck
                if (duck && tRex.jumping && !tRex.speedDrop) {
                    tRex.setSpeedDrop();
                    genome.score += 10
                } else if (duck && !tRex.jumping && !tRex.ducking) {
                    tRex.setDuck(true);
                } else if (!duck && !jump) {
                    tRex.speedDrop = false;
                    tRex.setDuck(false)
                }
    
                if (tRex.jumping) {
                    tRex.updateJump(deltaTime);
                }
    
                let collision = hasObstacles && checkForCollision(this.horizon.obstacles[0], tRex);
                if(collision) {
                    tRex.dead = true
                }
    
                if(!shouldDuck) genome.score += 1
                if(shouldDuck && ducking) genome.score += 2

                tRex.update(deltaTime); 
            });
    
            this.distanceRan += this.currentSpeed * deltaTime / this.msPerFrame;
            if (this.currentSpeed < this.config.MAX_SPEED) {
                this.currentSpeed += this.config.ACCELERATION;
            }

            if(tick % 10000 == 0 && !network) {
                Runner.instance_.gameOverPanel = { reset: () => { } }
                Runner.instance_.raqId = 0
                Runner.instance_.restart()
                Runner.instance_.tRexes.forEach(tRex => { tRex.reset(); });    
                return
            }

            // if(tick % 1000 != 0 && !network) {
            //     this.update()
            // } else {
            if(network) {
                this.scheduleNextUpdate();
            }
                
            // }
        }
    
        Runner.instance_.update = update    

        if(network) {
            Runner.instance_.tRexes = [new Trex(Runner.instance_.canvas, Runner.instance_.spriteDef.TREX)]
        } else {
            Runner.instance_.tRexes = Array.from({ length: population }, () => new Trex(Runner.instance_.canvas, Runner.instance_.spriteDef.TREX));
            neat.population.forEach(genome => genome.score = 0)
        }
        // Force Start
        if (!Runner.instance_.activated) {
            Runner.instance_.containerEl.style.width = Runner.instance_.dimensions.WIDTH + 'px';
            Runner.instance_.setPlayStatus(true);
            Runner.instance_.activated = true;
            Runner.instance_.startGame()
        } else {
            Runner.instance_.gameOverPanel = { reset: () => { } }
            Runner.instance_.raqId = 0
            Runner.instance_.restart()
            Runner.instance_.tRexes.forEach(tRex => { tRex.reset(); });
        }   
        
        if(!network) {
            while(!resolved) {
                Runner.instance_.update()
            }
        }
    })
}

const trainButtonId = "train-button"
async function startTraining() {
    const trainbutton = document.getElementById(trainButtonId)
    trainbutton.textContent = "Stop Training"
    trainbutton.onclick = stopTraining

    training = true
    while(training) {
        await run()
    }
}
async function copyToClipboard(textToCopy) {
    const textArea = document.createElement("textarea");
    textArea.value = textToCopy;
        
    // Move textarea out of the viewport so it's not visible
    textArea.style.position = "absolute";
    textArea.style.left = "-999999px";
        
    document.body.prepend(textArea);
    textArea.select();

    try {
        document.execCommand('copy');
    } catch (error) {
        console.error(error);
    } finally {
        textArea.remove();
    }
}

function stopTraining() {
    const trainbutton = document.getElementById(trainButtonId)
    trainbutton.textContent = "Train"
    trainbutton.onclick = startTraining

    setupNeat()
    training = false
    generation = 0

    copyToClipboard(bestNetworkJson).then(() => {
        alert("Network copied to clipboard")
    });
}

async function play() {
    const networkJSON = prompt("Please please paste your network");
    if(!networkJSON || networkJSON.length == 0) return

    const network = Network.fromJSON(JSON.parse(networkJSON))
    run(network)
}

function ensureButtons() {
    let gameContainer = document.getElementById('main-frame-error')
    let flexContainer = document.getElementById('button-container');

    if (!flexContainer) {
        flexContainer = document.createElement('div');
        flexContainer.id = 'button-container';
        flexContainer.style.display = 'flex';
        flexContainer.style.justifyContent = 'space-between';
        flexContainer.style.margin = '10px';
        flexContainer.style.maxWidth = "600px";
        gameContainer.appendChild(flexContainer);
    } else {
        flexContainer.innerHTML = '';
    }

    let button = document.createElement('button');
    button.id = trainButtonId;
    button.textContent = "Train";
    button.onclick = startTraining;
    flexContainer.appendChild(button);

    button = document.createElement('button');
    button.id = "play-button";
    button.textContent = "Play";
    button.onclick = play
    flexContainer.appendChild(button);
}

function setupNeat() {
    window.neat = new Neat(
        inputs,
        outputs,
        null,
        {
            // mutation: neataptic.methods.mutation.ALL,
            popsize: population,
            mutationRate: 0.3,
            elitism: Math.round(0.1 * population)
        }
    )
}

const neatapticScriptId = "neataptic"
if (!document.getElementById(neatapticScriptId)) {
    var script = document.createElement('script');
    script.id = neatapticScriptId
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/neataptic/1.4.7/neataptic.min.js';
    script.onload = () => {
        window.Neat = neataptic.Neat
        window.Network = neataptic.Network
        setupNeat()
        ensureButtons()
    }
    document.body.appendChild(script)
} else {
    ensureButtons()
}
