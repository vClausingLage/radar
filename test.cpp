#include <iostream>
#include <thread>
#include <cmath>
#include <chrono>

constexpr double SPEED_OF_TRAVEL = 10; // m/s
constexpr int TIME_STEP = 200; // milliseconds

class Vector {
    public: 
        struct Vector3 {
            double x, y, z;

            Vector3(double x = 0, double y = 0, double z = 0) : x(x), y(y), z(z) {}

            // Calculate the distance to another point in 3D space
            double distanceTo(const Vector3& other) const {
                return std::sqrt(
                    (x - other.x) * (x - other.x) +
                    (y - other.y) * (y - other.y) +
                    (z - other.z) * (z - other.z)
                );
            }
        };
};

class Signal {
    public:
        Vector::Vector3 position;
        Vector::Vector3 direction;
        double speed;

        Signal(const Vector::Vector3& pos, const Vector::Vector3& dir, double spd)
            : position(pos), direction(dir), speed(spd) {}

        void move(double time) {
            position.x += direction.x * speed * time;
            position.y += direction.y * speed * time;
            position.z += direction.z * speed * time;
        }
};

class Radar {
    public:
        Vector::Vector3 position;

        Radar(const Vector::Vector3& pos) : position(pos) {}

        Signal transmit(const Vector::Vector3& target) const {
            Vector::Vector3 direction(
                target.x - position.x,
                target.y - position.y,
                target.z - position.z
            );
            double length = std::sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
            direction.x /= length;
            direction.y /= length;
            direction.z /= length;
            return Signal(position, direction, SPEED_OF_TRAVEL);
        }
};

class Target {
    public:
        Vector::Vector3 position;
        Vector::Vector3 size;

        Target(const Vector::Vector3& pos, const Vector::Vector3& sz) : position(pos), size(sz) {}

        bool isHit(const Vector::Vector3& signalPos) const {
            return (signalPos.x >= position.x && signalPos.x <= position.x + size.x) &&
                (signalPos.y >= position.y && signalPos.y <= position.y + size.y) &&
                (signalPos.z >= position.z && signalPos.z <= position.z + size.z);
        }
};

class Search {
    Radar radar;
    Target target;
    Signal signal;
    public:
        //! METHODS MUST BE IN RADAR
        //! DESTROY SIGNAL OBJECT
        //! USE A CONST FOR SEARCH DIRECTION
        Search(const Radar& radar, const Target& target) : radar(radar), target(target), signal(radar.transmit(Vector::Vector3(10, 0 ,0))) {}

        double time = 0.0;
        double timeStep = 0.1;
        bool hit = false;

        void turnRadarDirection() {
            // Rotate the direction 1 degree to the right
            double angle = 1.0 * M_PI / 180.0; // 1 degree in radians
            double newX = signal.direction.x * std::cos(angle) - signal.direction.y * std::sin(angle);
            double newY = signal.direction.x * std::sin(angle) + signal.direction.y * std::cos(angle);
            signal.direction.x = newX;
            signal.direction.y = newY;
            std::cout << "Signal direction: (" << signal.direction.x << ", " << signal.direction.y << ")" << std::endl;
        }

        void resetSignal() {
            signal.position = radar.position;
            time = 0.0;
        }

        void emitSignal() {
            
        }

        void search() {
            //! LET SIGNAL PASS TO MAP END
            while (time < 1.0) {
                signal.move(timeStep);
                time += timeStep;
            
                std::cout << "Signal position: (" << signal.position.x << ", " << signal.position.y << ", " << signal.position.z << ")" << std::endl;
        
                if (target.isHit(signal.position)) {
                    hit = true;
                    break;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(TIME_STEP));
            }

            if (hit) {
                std::cout << "Signal hit the target!" << std::endl;
            } else {
                std::cout << "Signal missed the target." << std::endl;
            }

            //! TURN RADAR 1°
            //! SEARCH AGAIN

            if (!hit) {
                turnRadarDirection();

                resetSignal();
            }

        }
};

int main() {
    // Create another projectile with direction 1 degree to the right
    // Vector::Vector3 targetRight = target.position;
    // double angle = 1.0 * M_PI / 180.0; // 1 degree in radians
    // targetRight.x = target.position.x * std::cos(angle) - target.position.y * std::sin(angle);
    // targetRight.y = target.position.x * std::sin(angle) + target.position.y * std::cos(angle);

    // Projectile projectileRight = shooter.shoot(targetRight);

    Target target(Vector::Vector3(10, 1, 0), Vector::Vector3(1, 1, 1));

    Vector::Vector3 radarPos = Vector::Vector3(0, 0, 0);

    Search search = Search(radarPos, target);
    
    search.search();

    return 0;
}