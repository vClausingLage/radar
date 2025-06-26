import { Target } from '../radar/entities/target';
import { Vector2 } from '../types';

export enum EnemyState {
    PATROL,    // Random movement patterns
    SEARCH,    // Actively searching for player
    TRACK,     // Following player
    ATTACK,    // Moving to attack position
    COOLDOWN,  // Wait after attacking
}

export type EnemyMissile = {
    position: Vector2;
    direction: Vector2;
    speed: number;
    burnTime: number;
    damage: number;
    active: boolean;
};

export class EnemyController {
    private state: EnemyState = EnemyState.PATROL;
    private stateDuration: number = 0;
    private playerLastKnownPosition: Vector2 | null = null;
    private detectionRange: number = 300;
    private attackRange: number = 200;
    private missiles: EnemyMissile[] = [];
    private cooldownTime: number = 3000; // milliseconds
    private currentCooldown: number = 0;
    private radarActivationTime: number = 0;
    private radarActiveDuration: number = 1500; // milliseconds
    private radarEnabled: boolean = false;
    private searchPatternAngle: number = 0;
    
    constructor(
        private target: Target,
        private scene: Phaser.Scene,
        private detectionProbability: number = 0.002 // Chance per frame to detect player
    ) {}
    
    update(delta: number, playerPosition: Vector2): void {
        // Update cooldown
        if (this.currentCooldown > 0) {
            this.currentCooldown -= delta;
        }
        
        // Update radar activation
        if (this.radarEnabled) {
            this.radarActivationTime += delta;
            if (this.radarActivationTime > this.radarActiveDuration) {
                this.radarEnabled = false;
                this.radarActivationTime = 0;
            }
        }
        
        // Update state duration
        this.stateDuration += delta;
        
        // Check for state transitions
        this.updateState(playerPosition);
        
        // Execute current state behavior
        switch (this.state) {
            case EnemyState.PATROL:
                this.executeBehaviorPatrol(delta);
                break;
            case EnemyState.SEARCH:
                this.executeBehaviorSearch(delta, playerPosition);
                break;
            case EnemyState.TRACK:
                this.executeBehaviorTrack(delta, playerPosition);
                break;
            case EnemyState.ATTACK:
                this.executeBehaviorAttack(delta, playerPosition);
                break;
            case EnemyState.COOLDOWN:
                this.executeBehaviorCooldown(delta);
                break;
        }
        
        // Update missiles
        this.updateMissiles(delta);
    }
    
    private updateState(playerPosition: Vector2): void {
        const distanceToPlayer = this.distanceTo(playerPosition);
        
        switch (this.state) {
            case EnemyState.PATROL:
                // Randomly detect player
                if (distanceToPlayer < this.detectionRange && Math.random() < this.detectionProbability) {
                    this.state = EnemyState.SEARCH;
                    this.stateDuration = 0;
                    this.activateRadar();
                }
                // Switch patrol pattern every 3 seconds
                else if (this.stateDuration > 3000) {
                    this.changePatrolDirection();
                    this.stateDuration = 0;
                }
                break;
                
            case EnemyState.SEARCH:
                if (this.canSeePlayer(playerPosition)) {
                    this.state = EnemyState.TRACK;
                    this.playerLastKnownPosition = { ...playerPosition };
                    this.stateDuration = 0;
                }
                // Give up search after 5 seconds
                else if (this.stateDuration > 5000) {
                    this.state = EnemyState.PATROL;
                    this.stateDuration = 0;
                }
                break;
                
            case EnemyState.TRACK:
                if (!this.canSeePlayer(playerPosition)) {
                    this.state = EnemyState.SEARCH;
                    this.stateDuration = 0;
                }
                else if (distanceToPlayer < this.attackRange) {
                    this.state = EnemyState.ATTACK;
                    this.stateDuration = 0;
                }
                break;
                
            case EnemyState.ATTACK:
                if (!this.canSeePlayer(playerPosition)) {
                    this.state = EnemyState.SEARCH;
                    this.stateDuration = 0;
                }
                else if (distanceToPlayer > this.attackRange) {
                    this.state = EnemyState.TRACK;
                    this.stateDuration = 0;
                }
                // After firing or waiting too long
                else if (this.stateDuration > 1500) {
                    this.state = EnemyState.COOLDOWN;
                    this.stateDuration = 0;
                    this.currentCooldown = this.cooldownTime;
                }
                break;
                
            case EnemyState.COOLDOWN:
                if (this.currentCooldown <= 0) {
                    if (this.canSeePlayer(playerPosition)) {
                        if (distanceToPlayer < this.attackRange) {
                            this.state = EnemyState.ATTACK;
                        } else {
                            this.state = EnemyState.TRACK;
                        }
                    } else {
                        this.state = EnemyState.SEARCH;
                    }
                    this.stateDuration = 0;
                }
                break;
        }
    }
    
    private executeBehaviorPatrol(delta: number): void {
        // Continue moving in current direction
        // Bouncing is handled by main class currently
    }
    
    private executeBehaviorSearch(delta: number, playerPosition: Vector2): void {
        // Implement search pattern - move in a widening circle or sweep pattern
        this.searchPatternAngle += 0.01 * delta;
        
        // Circular search pattern
        const searchRadius = 1.5;
        const dirX = Math.cos(this.searchPatternAngle) * searchRadius;
        const dirY = Math.sin(this.searchPatternAngle) * searchRadius;
        
        // Update direction with a slower change
        this.target.direction.x += (dirX - this.target.direction.x) * 0.01;
        this.target.direction.y += (dirY - this.target.direction.y) * 0.01;
        
        // Normalize direction vector
        const magnitude = Math.sqrt(
            this.target.direction.x * this.target.direction.x + 
            this.target.direction.y * this.target.direction.y
        );
        
        if (magnitude > 0) {
            this.target.direction.x /= magnitude;
            this.target.direction.y /= magnitude;
        }
        
        // Periodically activate radar
        if (!this.radarEnabled && Math.random() < 0.005) {
            this.activateRadar();
        }
    }
    
    private executeBehaviorTrack(delta: number, playerPosition: Vector2): void {
        // Move toward player
        this.moveToward(playerPosition, delta);
        
        // Keep radar on while tracking
        if (!this.radarEnabled && Math.random() < 0.05) {
            this.activateRadar();
        }
    }
    
    private executeBehaviorAttack(delta: number, playerPosition: Vector2): void {
        // Move to optimal attack position - maintain some distance
        const dx = this.target.position.x - playerPosition.x;
        const dy = this.target.position.y - playerPosition.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const optimalRange = this.attackRange * 0.8;
        
        if (distance < optimalRange - 20) {
            // Move away slightly
            this.moveAway(playerPosition, delta);
        } else if (distance > optimalRange + 20) {
            // Move closer slightly
            this.moveToward(playerPosition, delta);
        } else {
            // We're at a good attack range, shoot if cooldown is ready
            if (this.currentCooldown <= 0 && Math.random() < 0.03) {
                this.shootAtPlayer(playerPosition);
            }
        }
        
        // Keep radar active during attack
        if (!this.radarEnabled) {
            this.activateRadar();
        }
    }
    
    private executeBehaviorCooldown(delta: number): void {
        // Move in evasive pattern
        const evasiveAngle = Math.sin(this.stateDuration / 500) * Math.PI;
        
        this.target.direction.x = Math.cos(evasiveAngle);
        this.target.direction.y = Math.sin(evasiveAngle);
        
        // Radar off during cooldown
        this.radarEnabled = false;
    }
    
    private moveToward(position: Vector2, delta: number): void {
        const dx = position.x - this.target.position.x;
        const dy = position.y - this.target.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            // Calculate desired direction
            const desiredDirX = dx / distance;
            const desiredDirY = dy / distance;
            
            // Gradually change direction (smoother movement)
            const turnRate = 0.03 * delta;
            this.target.direction.x += (desiredDirX - this.target.direction.x) * turnRate;
            this.target.direction.y += (desiredDirY - this.target.direction.y) * turnRate;
            
            // Normalize direction
            const magnitude = Math.sqrt(
                this.target.direction.x * this.target.direction.x + 
                this.target.direction.y * this.target.direction.y
            );
            
            if (magnitude > 0) {
                this.target.direction.x /= magnitude;
                this.target.direction.y /= magnitude;
            }
        }
    }
    
    private moveAway(position: Vector2, delta: number): void {
        const dx = this.target.position.x - position.x;
        const dy = this.target.position.y - position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            // Calculate desired direction (away from player)
            const desiredDirX = dx / distance;
            const desiredDirY = dy / distance;
            
            // Gradually change direction
            const turnRate = 0.03 * delta;
            this.target.direction.x += (desiredDirX - this.target.direction.x) * turnRate;
            this.target.direction.y += (desiredDirY - this.target.direction.y) * turnRate;
            
            // Normalize direction
            const magnitude = Math.sqrt(
                this.target.direction.x * this.target.direction.x + 
                this.target.direction.y * this.target.direction.y
            );
            
            if (magnitude > 0) {
                this.target.direction.x /= magnitude;
                this.target.direction.y /= magnitude;
            }
        }
    }
    
    private distanceTo(position: Vector2): number {
        const dx = position.x - this.target.position.x;
        const dy = position.y - this.target.position.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    private canSeePlayer(playerPosition: Vector2): boolean {
        // First check if radar is on (better detection)
        if (this.radarEnabled) {
            return this.distanceTo(playerPosition) < this.detectionRange;
        }
        
        // Without radar, shorter visual range
        return this.distanceTo(playerPosition) < (this.detectionRange * 0.6);
    }
    
    private activateRadar(): void {
        this.radarEnabled = true;
        this.radarActivationTime = 0;
        
        // Visual indication of radar activation (optional)
        const radarCircle = this.scene.add.circle(
            this.target.position.x,
            this.target.position.y,
            20,
            0x00ff00,
            0.2
        );
        
        this.scene.tweens.add({
            targets: radarCircle,
            scale: 3,
            alpha: 0,
            duration: 1000,
            onComplete: () => {
                radarCircle.destroy();
            }
        });
    }
    
    private changePatrolDirection(): void {
        // Random new direction
        const angle = Math.random() * Math.PI * 2;
        this.target.direction = {
            x: Math.cos(angle),
            y: Math.sin(angle)
        };
    }
    
    private shootAtPlayer(playerPosition: Vector2): void {
        // Calculate direction to player
        const dx = playerPosition.x - this.target.position.x;
        const dy = playerPosition.y - this.target.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            console.log("Enemy firing missile at player!");
            
            // Create missile
            const missile: EnemyMissile = {
                position: { ...this.target.position },
                direction: {
                    x: dx / distance,
                    y: dy / distance
                },
                speed: 6,
                burnTime: 8,
                damage: 1,
                active: true
            };
            
            this.missiles.push(missile);
            
            // Visual feedback - enemy is firing
            const flash = this.scene.add.circle(
                this.target.position.x,
                this.target.position.y,
                10,
                0xff0000,
                0.8
            );
            
            this.scene.tweens.add({
                targets: flash,
                scale: 2,
                alpha: 0,
                duration: 300,
                onComplete: () => {
                    flash.destroy();
                }
            });
        }
    }
    
    private updateMissiles(delta: number): void {
        for (let i = this.missiles.length - 1; i >= 0; i--) {
            const missile = this.missiles[i];
            
            // Update position
            missile.position.x += missile.direction.x * missile.speed * delta / 1000;
            missile.position.y += missile.direction.y * missile.speed * delta / 1000;
            
            // Reduce burnTime
            missile.burnTime -= delta / 1000;
            
            // Remove expired missiles
            if (missile.burnTime <= 0) {
                this.missiles.splice(i, 1);
                continue;
            }
            
            // Draw missile (this could be moved to a renderer class)
            this.scene.add.circle(
                missile.position.x,
                missile.position.y,
                3,
                0xff0000,
                0.8
            ).setDepth(5);
        }
    }
    
    getMissiles(): EnemyMissile[] {
        return this.missiles;
    }
    
    isRadarActive(): boolean {
        return this.radarEnabled;
    }
    
    getState(): EnemyState {
        return this.state;
    }
    
    removeMissile(missile: EnemyMissile): void {
        const index = this.missiles.indexOf(missile);
        if (index > -1) {
            this.missiles.splice(index, 1);
        }
    }
}