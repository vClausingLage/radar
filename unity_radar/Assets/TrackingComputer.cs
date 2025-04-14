public class TrackingComputer
{
    private int? lastDegree = null;

    public TrackingComputer()
    {
        this.lastDegree = null;
    }

    public void Transceive(int degree, UnityEngine.Vector3 point)
    {
        if (degree - this.lastDegree == 1) {
            // add to existing Track
            this.lastDegree = degree;
        }
        if (degree - this.lastDegree > 1 || this.lastDegree == null) {
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