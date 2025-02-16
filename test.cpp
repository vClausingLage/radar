#include <iostream>
#include <thread>
#include <cmath>
#include <chrono>
#include <vector>
#include <chrono>

constexpr double SPEED_OF_TRAVEL = 20; // m/s
constexpr int TIME_STEP = 2; // milliseconds

class Vector3 {
    public:
        double x, y, z;
        
        Vector3(double x = 0, double y = 0, double z = 0) : x(x), y(y), z(z) {}
    
        double distanceTo(const Vector3& other) const {
            return std::sqrt((x - other.x) * (x - other.x) +
                             (y - other.y) * (y - other.y) +
                             (z - other.z) * (z - other.z));
        }
    
        void normalize() {
            double length = std::sqrt(x * x + y * y + z * z);
            if (length > 0) {
                x /= length;
                y /= length;
                z /= length;
            }
        }
    };
    

class Signal {
    public:
        Vector3 position;
        Vector3 direction;
        double speed;

        Signal(const Vector3& pos, const Vector3& dir, double spd)
            : position(pos), direction(dir), speed(spd) {}

        void move(double time) {
            position.x += direction.x * speed * time;
            position.y += direction.y * speed * time;
            position.z += direction.z * speed * time;
        }

        void reflectToRadar(const Vector3& radarPosition) {
            // Reflect the signal back to the radar
            direction.x = radarPosition.x - position.x;
            direction.y = radarPosition.y - position.y;
            direction.z = radarPosition.z - position.z;
            direction.normalize();
        }
};

class Radar {
    public:
        Vector3 position;
        Vector3 pulseDirection;

        Radar(const Vector3& pos) : position(pos) {}

        Signal transmit(const Vector3& pulseDirection) const {
            Vector3 direction(
                pulseDirection.x - position.x,
                pulseDirection.y - position.y,
                pulseDirection.z - position.z
            );
            double length = std::sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
            direction.x /= length;
            direction.y /= length;
            direction.z /= length;
            return Signal(position, direction, SPEED_OF_TRAVEL);
        }

        void turnRadarDirection(Vector3& pulseDirection, int i) {
            double radians = i * M_PI / 180.0;
            double length = std::sqrt(pulseDirection.x * pulseDirection.x + pulseDirection.y * pulseDirection.y);
            std::cout << "Length: " << length << std::endl;
            // Rotate the direction 1 degree to the right
            double newX = length * cos(radians);
            double newY = length * sin(radians);
            pulseDirection.x = newX;
            pulseDirection.y = newY;
        }
};

class Target {
    public:
        Vector3 position;
        Vector3 size;

        Target(const Vector3& pos, const Vector3& sz) : position(pos), size(sz) {}

        bool isHit(const Vector3& signalPos) const {
            return (signalPos.x >= position.x && signalPos.x <= position.x + size.x) &&
                (signalPos.y >= position.y && signalPos.y <= position.y + size.y) &&
                (signalPos.z >= position.z && signalPos.z <= position.z + size.z);
        }
};

class Map {
    public:
        Vector3 center;
        double length, width, height;

        Map(const Vector3& center, double length, double width, double height)
            : center(center), length(length), width(width), height(height) {}

        bool isWithinBounds(const Vector3& position) const {
            return (position.x >= center.x - length / 2 && position.x <= center.x + length / 2) &&
                   (position.y >= center.y - width / 2 && position.y <= center.y + width / 2) &&
                   (position.z >= center.z - height / 2 && position.z <= center.z + height / 2);
        }

        double diagonal() const {
            return std::ceil(std::sqrt(length * length + width * width + height * height));
        }
};

class Track {

};

class Search {
    Radar radar;
    Map map;
    Target target;
    public:
        Search(const Radar& radar, const Map map, const Target& target) : radar(radar), map(map), target(target) {}
        
        void search(Vector3 i, int j) {
            std::cout << "Search index " << j << std::endl;
            double time = 0.0;
            double timeStep = 0.1;
            bool hit = false;
            radar.pulseDirection = i;
            std::chrono::steady_clock::time_point begin = std::chrono::steady_clock::now();
            Signal signal = radar.transmit(radar.pulseDirection);
            // std::cout << "Pulse direction begin search: (" << radar.pulseDirection.x << ", " << radar.pulseDirection.y << ", " << radar.pulseDirection.z << ")" << std::endl;
            int maxDistance = map.diagonal();
            // std::cout << "Max distance: " << maxDistance << std::endl;
            for (int step = 0; step < maxDistance && map.isWithinBounds(Vector3(signal.position)); step++) {
                signal.move(timeStep);
                time += timeStep;
            
                // std::cout << "Signal position: (" << signal.position.x << ", " << signal.position.y << ", " << signal.position.z << ")" << std::endl;
        
                if (target.isHit(signal.position)) {
                    hit = true;
                    break;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(TIME_STEP));
            }

            if (hit) {
                std::cout << "Signal hit target!" << std::endl;
                std::cout << radar.pulseDirection.x << ", " << radar.pulseDirection.y << ", " << radar.pulseDirection.z << std::endl;
                //! change doppler effect
                signal.reflectToRadar(radar.position);
                for (int step = 0; step < maxDistance && map.isWithinBounds(signal.position); step++) {
                    signal.move(timeStep);
                    std::cout << "Signal returning position: (" << signal.position.x << ", " << signal.position.y << ", " << signal.position.z << ")" << std::endl;
                    if (signal.position.distanceTo(radar.position) < 1.0) {
                        std::cout << "Signal returned to radar!" << std::endl;
                        break;
                    }
                }
            }
            else {
                // std::cout << "No target." << std::endl;
            }

            // radar.turnRadarDirection(radar.pulseDirection, i);
            // std::cout << "Pulse direction after search: (" << radar.pulseDirection.x << ", " << radar.pulseDirection.y << ", " << radar.pulseDirection.z << ")" << std::endl;
            std::chrono::steady_clock::time_point end = std::chrono::steady_clock::now();
            // std::cout << "Time difference = " << std::chrono::duration_cast<std::chrono::milliseconds>(end - begin).count() << "[milliseconds]" << std::endl;
        }
};

std::vector<Vector3> generateDirectionalVectors() {
    std::vector<Vector3> vectors;
    for (int yawDegrees = 0; yawDegrees < 360; ++yawDegrees) {
        // for (int pitchDegrees = 0; pitchDegrees < 181; ++pitchDegrees) { //181 to include straight up and down.
            double yawRadians = yawDegrees * M_PI / 180.0;
            // double pitchRadians = (pitchDegrees - 90) * M_PI / 180.0; // 90 to 90 pitch

            Vector3 vector;
            vector.x = cos(yawRadians);// * cos(pitchRadians);
            vector.y = sin(yawRadians);// * cos(pitchRadians);
            //! ignore pitch for now
            vector.z = 0;
            // vector.z = sin(pitchRadians);

            vectors.push_back(vector);
        // }
    }
    return vectors;
};

int main() {
    // I
    // Map
    Map map(Vector3(0, 0, 0), 50, 50, 50);

    // II
    // spawn target(s)
    Target target(Vector3(5, 5, 0), Vector3(1, 1, 1));
    //! implement search for multiple targets
    // std::vector<Target> targets;
    // targets.push_back(target);
    // targets.push_back(Target(Vector3(15, 5, 0), Vector3(1, 1, 1)));
    // targets.push_back(Target(Vector3(20, 10, 0), Vector3(1, 1, 1)));

    // III
    // spawn radar
    Vector3 radarPos = Vector3(0, 0, 0);
    Radar radar(radarPos);
    // radar config
    Vector3 pulseDirection = Vector3(10, 0, 0);
    radar.pulseDirection = pulseDirection;
    //! into class
    std::vector<Vector3> directions = generateDirectionalVectors();

    // IV
    // search for targets
    Search search = Search(radar, map, target);
    for (int i = 0; i < directions.size(); i++) {
        search.search(directions[i], i);
    }

    return 0;
}