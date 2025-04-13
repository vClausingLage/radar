using RadarSystem;

public class TrackingComputer
{
    private number lastDegree;

    public TrackingComputer()
    {
        this.lastDegree = 0;
    }

    public void transceive(degree, point)
    {
        if (degree - this.lastDegree == 1) {
            // add to existing Track
        }
        if (degree - this.lastDegree > 1 || !this.lastDegree) {
            // create new Track
        }
    } 


    public Track[] getTracks()
    {
        Track[] tracks = new Track[10];
        for (int i = 0; i < tracks.Length; i++)
        {
            tracks[i] = new Track();
        }
        return tracks;
    }
}